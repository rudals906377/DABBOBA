import type { FastifyInstance, FastifyRequest } from "fastify";
import { USER_STATUSES, type UserRole, type UserStatus } from "@dabboba/domain";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { writeAdminAudit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { enumInput, nullableStringInput, objectInput, queryString, stringInput, uuidInput } from "../lib/input.js";
import { cursorPage, pagination } from "../lib/pagination.js";
import { hashPassword } from "../lib/password.js";
import { browserLabel, iso, maskEmail, maskIp, nullableIso, numberValue } from "../lib/rows.js";
import type { ApiContext } from "../types.js";

type UserRow = {
  id: string; email: string; nickname: string; role: UserRole; status: UserStatus; suspended_until: Date | null;
  suspension_reason: string | null; created_at: Date; post_count: number | string; report_count: number | string;
  inquiry_count?: number | string; snap_count?: number | string;
};

type AuditRow = {
  id: string; admin_id: string; admin_email: string; action: string; target_type: string; target_id: string;
  reason: string | null; request_id: string; metadata: Record<string, unknown>; ip_address: string | null; user_agent: string | null; created_at: Date;
};

const userSelect = `
  SELECT u.id,u.email::text,u.nickname,u.role,u.status,u.suspended_until,u.suspension_reason,u.created_at,
    (SELECT count(*) FROM community_posts p WHERE p.author_id=u.id) AS post_count,
    ((SELECT count(*) FROM content_reports r WHERE r.target_type='USER' AND r.target_id=u.id)
      + (SELECT count(*) FROM community_posts reported_post JOIN content_reports r ON r.target_id=reported_post.id
         WHERE reported_post.author_id=u.id AND ((reported_post.kind='SNAP' AND r.target_type='SNAP') OR (reported_post.kind<>'SNAP' AND r.target_type='POST')))
      + (SELECT count(*) FROM community_comments reported_comment JOIN content_reports r ON r.target_type='COMMENT' AND r.target_id=reported_comment.id
         WHERE reported_comment.author_id=u.id)
      + (SELECT count(*) FROM exchange_listings reported_listing JOIN content_reports r ON r.target_type='EXCHANGE_LISTING' AND r.target_id=reported_listing.id
         WHERE reported_listing.author_id=u.id)) AS report_count
  FROM users u`;

const mapUser = (row: UserRow) => ({
  id: row.id,
  emailMasked: maskEmail(row.email),
  nickname: row.nickname,
  role: row.role,
  status: row.status,
  postCount: numberValue(row.post_count),
  reportCount: numberValue(row.report_count),
  suspendedUntil: nullableIso(row.suspended_until),
  createdAt: iso(row.created_at),
});

const ADMIN_USER_STATUS_MUTATIONS = ["ACTIVE", "SUSPENDED", "BANNED"] as const;

function queryOf(request: FastifyRequest) { return (request.query || {}) as Record<string, unknown>; }

export async function registerAdminRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/admin/dashboard", { preHandler: context.auth.requirePermission("dashboard.read") }, async () => {
    const result = await context.pool.query<{
      total_users: number | string; users_joined_today: number | string; posts_today: number | string; snaps_today: number | string;
      unanswered_inquiries: number | string; pending_reports: number | string; pending_product_requests: number | string; pending_ip_requests: number | string;
    }>(`
      SELECT
        (SELECT count(*) FROM users WHERE role='USER' AND status<>'DELETED') AS total_users,
        (SELECT count(*) FROM users WHERE role='USER' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS users_joined_today,
        (SELECT count(*) FROM community_posts WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS posts_today,
        (SELECT count(*) FROM community_posts WHERE kind='SNAP' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS snaps_today,
        (SELECT count(*) FROM inquiries WHERE status IN ('PENDING','IN_PROGRESS')) AS unanswered_inquiries,
        (SELECT count(*) FROM content_reports WHERE status IN ('PENDING','REVIEWING')) AS pending_reports,
        (SELECT count(*) FROM catalog_requests WHERE kind='PRODUCT' AND status='PENDING') AS pending_product_requests,
        (SELECT count(*) FROM catalog_requests WHERE kind='IP' AND status='PENDING') AS pending_ip_requests
    `);
    const row = result.rows[0]!;
    return {
      totalUsers: numberValue(row.total_users), usersJoinedToday: numberValue(row.users_joined_today),
      postsToday: numberValue(row.posts_today), snapsToday: numberValue(row.snaps_today),
      unansweredInquiries: numberValue(row.unanswered_inquiries), pendingReports: numberValue(row.pending_reports),
      pendingProductRequests: numberValue(row.pending_product_requests), pendingIpRequests: numberValue(row.pending_ip_requests),
      generatedAt: new Date().toISOString(),
    };
  });

  app.get("/v1/admin/users", { preHandler: context.auth.requirePermission("users.read") }, async (request) => {
    const query=queryOf(request);const {limit,cursor}=pagination(query);const search=queryString(query.q);const status=query.status===undefined?undefined:enumInput(query,"status",USER_STATUSES);
    const values:unknown[]=[limit+1];const filters=["u.role='USER'"];
    if(search){values.push(`%${search}%`);filters.push(`(u.nickname ILIKE $${values.length} OR u.email::text ILIKE $${values.length} OR u.id::text ILIKE $${values.length})`);}
    if(status){values.push(status);filters.push(`u.status=$${values.length}`);}if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(u.created_at,u.id)<($${values.length-1},$${values.length})`);}
    const result=await context.pool.query<UserRow>(`${userSelect} WHERE ${filters.join(" AND ")} ORDER BY u.created_at DESC,u.id DESC LIMIT $1`,values);return cursorPage(result.rows,limit,mapUser);
  });

  app.get("/v1/admin/users/:userId", { preHandler: context.auth.requirePermission("users.read") }, async (request) => {
    const id=uuidInput((request.params as Record<string,unknown>).userId,"userId");
    const result=await context.pool.query<UserRow>(`${userSelect.replace("FROM users u", `,
      (SELECT count(*) FROM inquiries i WHERE i.user_id=u.id) AS inquiry_count,
      (SELECT count(*) FROM community_posts p WHERE p.author_id=u.id AND p.kind='SNAP') AS snap_count
      FROM users u`)}
      WHERE u.id=$1`,[id]);
    if(!result.rowCount)throw notFound();const row=result.rows[0]!;return {...mapUser(row),inquiryCount:numberValue(row.inquiry_count),snapCount:numberValue(row.snap_count),suspensionReason:row.suspension_reason};
  });

  app.post("/v1/admin/users/:userId/status", { preHandler: context.auth.requirePermission("users.suspend") }, async (request, reply) => {
    const id=uuidInput((request.params as Record<string,unknown>).userId,"userId");const body=objectInput(request.body);const status=enumInput(body,"status",ADMIN_USER_STATUS_MUTATIONS)!;const reason=stringInput(body,"reason",{max:1000})!;const rawUntil=nullableStringInput(body,"suspendedUntil",{max:40});
    if(status==="BANNED"&&request.actor!.role!=="SUPER_ADMIN")throw forbidden("계정 차단은 최고 관리자만 할 수 있습니다.");
    const suspendedUntil=rawUntil?new Date(rawUntil):null;if(rawUntil&&Number.isNaN(suspendedUntil!.getTime()))throw badRequest("정지 종료일을 확인해 주세요.");if(suspendedUntil&&suspendedUntil<=new Date())throw badRequest("정지 종료일은 현재보다 이후여야 합니다.");if(status!=="SUSPENDED"&&rawUntil)throw badRequest("정지 종료일은 이용정지 상태에서만 설정할 수 있습니다.");
    const result=await adminIdempotentMutation(context,request,{target:{type:"USER",id},bodyReason:reason,work:async(client)=>{const before=await client.query<UserRow>(`${userSelect} WHERE u.id=$1 FOR UPDATE OF u`,[id]);if(!before.rowCount)throw notFound();if(before.rows[0]!.role!=="USER")throw forbidden("관리자 계정은 관리자 계정 관리에서 변경해 주세요.");
      if(before.rows[0]!.status==="DELETED")throw conflict("탈퇴 처리된 계정은 일반 상태 변경으로 복구할 수 없습니다.");
      if(before.rows[0]!.status==="BANNED"&&request.actor!.role!=="SUPER_ADMIN")throw forbidden("차단 계정은 최고 관리자만 상태를 변경할 수 있습니다.");
      await client.query("UPDATE users SET status=$2,suspended_until=$3,suspension_reason=$4,deleted_at=NULL WHERE id=$1",[id,status,status==="SUSPENDED"?suspendedUntil:null,status==="ACTIVE"?null:reason]);
      await client.query("UPDATE user_suspensions SET revoked_at=now(),revoked_by=$2 WHERE user_id=$1 AND revoked_at IS NULL",[id,request.actor!.userId]);
      if(status==="SUSPENDED")await client.query("INSERT INTO user_suspensions(user_id,created_by,reason,ends_at) VALUES($1,$2,$3,$4)",[id,request.actor!.userId,reason,suspendedUntil]);
      if(status!=="ACTIVE")await client.query("UPDATE sessions SET revoked_at=now(),revoke_reason=$2 WHERE user_id=$1 AND revoked_at IS NULL",[id,`ADMIN_${status}`]);
      const after=await client.query<UserRow>(`${userSelect} WHERE u.id=$1`,[id]);await writeAdminAudit(client,request,request.actor!,{action:"USER_STATUS_CHANGED",targetType:"USER",targetId:id,reason,before:before.rows[0],after:after.rows[0]});return{statusCode:200,body:mapUser(after.rows[0]!),resourceType:"USER",resourceId:id};}});return sendAdminMutation(reply,result);
  });

  app.get("/v1/admin/administrators", { preHandler: context.auth.requireSuperAdmin }, async (request) => {
    const query=queryOf(request);const {limit,cursor}=pagination(query);const values:unknown[]=[limit+1];const filters=["u.role IN ('ADMIN','SUPER_ADMIN')"];
    if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(u.created_at,u.id)<($${values.length-1},$${values.length})`);}const result=await context.pool.query<UserRow>(`${userSelect} WHERE ${filters.join(" AND ")} ORDER BY u.created_at DESC,u.id DESC LIMIT $1`,values);return cursorPage(result.rows,limit,mapUser);
  });

  app.post("/v1/admin/administrators", { preHandler: context.auth.requireSuperAdmin }, async (request,reply) => {
    const body=objectInput(request.body);const email=stringInput(body,"email",{max:254})!.toLocaleLowerCase("en-US");const nickname=stringInput(body,"nickname",{min:2,max:40})!;const password=stringInput(body,"password",{min:12,max:256,trim:false})!;const role=enumInput(body,"role",["ADMIN","SUPER_ADMIN"] as const)!;
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw badRequest("이메일 형식을 확인해 주세요.");
    const result=await adminIdempotentMutation(context,request,{target:{type:"ADMIN",email},work:async(client)=>{const credential=await hashPassword(password);const created=await client.query<UserRow>(`INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id,email::text,nickname,role,status,suspended_until,suspension_reason,created_at,0 AS post_count,0 AS report_count`,[email,nickname,role]);const value=created.rows[0]!;
      await client.query("INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at) VALUES($1,'LOCAL_ADMIN',$2,now())",[value.id,email]);await client.query(`INSERT INTO admin_credentials(user_id,password_hash,password_salt,scrypt_cost,scrypt_block_size,scrypt_parallelization) VALUES($1,$2,$3,$4,$5,$6)`,[value.id,credential.hash,credential.salt,credential.cost,credential.blockSize,credential.parallelization]);await writeAdminAudit(client,request,request.actor!,{action:"ADMIN_CREATED",targetType:"USER",targetId:value.id,after:{role,emailMasked:maskEmail(email)}});return{statusCode:201,body:mapUser(value),resourceType:"USER",resourceId:value.id};}});return sendAdminMutation(reply,result);
  });

  app.patch("/v1/admin/administrators/:userId", { preHandler: context.auth.requireSuperAdmin }, async (request, reply) => {
    const id=uuidInput((request.params as Record<string,unknown>).userId,"userId");if(id===request.actor!.userId)throw forbidden("현재 로그인한 관리자 계정은 스스로 비활성화하거나 권한을 변경할 수 없습니다.");const body=objectInput(request.body);const role=enumInput(body,"role",["ADMIN","SUPER_ADMIN"] as const)!;const status=enumInput(body,"status",["ACTIVE","SUSPENDED","BANNED"] as const)!;const reason=stringInput(body,"reason",{max:1000})!;
    const result=await adminIdempotentMutation(context,request,{target:{type:"ADMIN",id},bodyReason:reason,beforeBegin:async(client)=>{await client.query("SELECT pg_advisory_xact_lock($1::bigint)",["4918842442568544577"]);},work:async(client)=>{const before=await client.query<UserRow>(`${userSelect} WHERE u.id=$1 FOR UPDATE OF u`,[id]);if(!before.rowCount)throw notFound();if(!["ADMIN","SUPER_ADMIN"].includes(before.rows[0]!.role))throw badRequest("관리자 계정이 아닙니다.");if(before.rows[0]!.role==="SUPER_ADMIN"&&(role!=="SUPER_ADMIN"||status!=="ACTIVE")){const count=await client.query<{count:string}>("SELECT count(*) FROM users WHERE role='SUPER_ADMIN' AND status='ACTIVE'",[]);if(Number(count.rows[0]!.count)<=1)throw conflict("마지막 활성 최고 관리자는 변경할 수 없습니다.");}
      await client.query("UPDATE users SET role=$2,status=$3,suspension_reason=CASE WHEN $3='ACTIVE' THEN NULL ELSE $4 END,suspended_until=NULL WHERE id=$1",[id,role,status,reason]);if(status!=="ACTIVE")await client.query("UPDATE sessions SET revoked_at=now(),revoke_reason='ADMIN_ACCOUNT_DISABLED' WHERE user_id=$1 AND revoked_at IS NULL",[id]);const after=await client.query<UserRow>(`${userSelect} WHERE u.id=$1`,[id]);await writeAdminAudit(client,request,request.actor!,{action:"ADMIN_CHANGED",targetType:"USER",targetId:id,reason,before:{role:before.rows[0]!.role,status:before.rows[0]!.status},after:{role,status}});return{statusCode:200,body:mapUser(after.rows[0]!),resourceType:"USER",resourceId:id};}});return sendAdminMutation(reply,result);
  });

  app.get("/v1/admin/audit-logs", { preHandler: context.auth.requirePermission("audit.read") }, async (request) => {
    const query=queryOf(request);const {limit,cursor}=pagination(query);const search=queryString(query.q);const action=queryString(query.action,100);const values:unknown[]=[limit+1];const filters:string[]=[];
    if(search){values.push(`%${search}%`);filters.push(`(a.action ILIKE $${values.length} OR a.target_type ILIKE $${values.length} OR a.target_id ILIKE $${values.length} OR u.email::text ILIKE $${values.length})`);}if(action){values.push(action);filters.push(`a.action=$${values.length}`);}if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(a.created_at,a.id)<($${values.length-1},$${values.length})`);}
    const result=await context.pool.query<AuditRow>(`SELECT a.*,u.email::text AS admin_email FROM admin_audit_logs a JOIN users u ON u.id=a.admin_id ${filters.length?`WHERE ${filters.join(" AND ")}`:""} ORDER BY a.created_at DESC,a.id DESC LIMIT $1`,values);
    return cursorPage(result.rows,limit,(row)=>({id:row.id,adminId:row.admin_id,adminEmailMasked:maskEmail(row.admin_email),action:row.action,targetType:row.target_type,targetId:row.target_id,reason:row.reason,requestId:row.request_id,metadata:row.metadata,ipAddressMasked:maskIp(row.ip_address),clientLabel:browserLabel(row.user_agent),createdAt:iso(row.created_at)}));
  });
}
