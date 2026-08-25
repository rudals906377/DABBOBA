import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTransaction, type DatabaseClient, type Queryable } from "@dabboba/db";
import { CONTENT_STATUSES, INQUIRY_STATUSES, REPORT_STATUSES, canTransitionInquiry, canTransitionReport } from "@dabboba/domain";
import { adminIdempotentMutation, sendAdminMutation } from "../lib/admin-idempotency.js";
import { adminMutationHeaders, writeAdminAudit, writeOutbox } from "../lib/audit.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { beginIdempotency, completeIdempotency, idempotencyKey, requestHash } from "../lib/idempotency.js";
import { booleanInput, enumInput, integerInput, nullableStringInput, objectInput, queryString, stringArrayInput, stringInput, uuidInput } from "../lib/input.js";
import { cursorPage, pagination } from "../lib/pagination.js";
import { iso, nullableIso, numberValue } from "../lib/rows.js";
import { assertReadyOwnedMedia } from "./media.js";
import type { ApiContext } from "../types.js";

type NoticeRow = {
  id: string; title: string; content: string; is_pinned: boolean; is_published: boolean;
  status: "ACTIVE" | "HIDDEN" | "DELETED"; created_by: string; published_at: Date | null;
  version: number; created_at: Date; updated_at: Date;
};
type InquiryRow = {
  id: string; user_id: string; category: string; title: string; status: (typeof INQUIRY_STATUSES)[number];
  assigned_admin_id: string | null; created_at: Date; updated_at: Date;
};
type InquiryMessageRow = {
  id: string; inquiry_id: string; author_id: string; author_role: "USER" | "ADMIN" | "SUPER_ADMIN";
  content: string; is_internal: boolean; media_ids: string[]; created_at: Date;
};
type PostRow = {
  id: string; author_id: string; author_nickname: string; ip_id: string | null; kind: "DUKROOM" | "SNAP" | "GENERAL";
  title: string; content: string; status: "ACTIVE" | "HIDDEN" | "DELETED"; report_count: number | string;
  comment_count: number | string; like_count: number | string; liked_by_viewer: boolean; media_ids: string[];
  version: number; created_at: Date; updated_at: Date;
};
type CommentRow = {
  id: string; post_id: string; author_id: string; author_nickname: string; content: string;
  status: "ACTIVE" | "HIDDEN" | "DELETED"; report_count: number | string; created_at: Date; updated_at: Date;
};
type ReportRow = {
  id: string; reporter_id: string; target_type: "POST" | "COMMENT" | "SNAP" | "USER" | "EXCHANGE_LISTING";
  target_id: string; reason: string; details: string | null; status: (typeof REPORT_STATUSES)[number];
  resolution: string | null; resolved_by: string | null; resolved_at: Date | null; target_preview?: string | null; target_status?: string | null; created_at: Date; updated_at: Date;
};
type BlockedUserRow = {
  id: string; nickname: string; created_at: Date;
};

const mapNotice = (row: NoticeRow) => ({
  id: row.id, title: row.title, content: row.content, isPinned: row.is_pinned, isPublished: row.is_published,
  status: row.status, createdBy: row.created_by, publishedAt: nullableIso(row.published_at), version: row.version,
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});
const mapInquiry = (row: InquiryRow) => ({
  id: row.id, userId: row.user_id, category: row.category, title: row.title, status: row.status,
  assignedAdminId: row.assigned_admin_id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});
const mapInquiryMessage = (row: InquiryMessageRow) => ({
  id: row.id, inquiryId: row.inquiry_id, authorId: row.author_id, authorRole: row.author_role,
  content: row.content, isInternal: row.is_internal, mediaIds: row.media_ids, createdAt: iso(row.created_at),
});
const mapPost = (row: PostRow) => ({
  id: row.id, authorId: row.author_id, authorNickname: row.author_nickname, ipId: row.ip_id, kind: row.kind,
  title: row.title, content: row.content, status: row.status, reportCount: numberValue(row.report_count),
  commentCount: numberValue(row.comment_count), likeCount: numberValue(row.like_count), likedByViewer: row.liked_by_viewer,
  mediaIds: row.media_ids, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});
const mapComment = (row: CommentRow) => ({
  id: row.id, postId: row.post_id, authorId: row.author_id, authorNickname: row.author_nickname,
  content: row.content, status: row.status, reportCount: numberValue(row.report_count),
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});
const mapReport = (row: ReportRow) => ({
  id: row.id, reporterId: row.reporter_id, targetType: row.target_type, targetId: row.target_id,
  reason: row.reason, details: row.details, status: row.status, resolution: row.resolution,
  resolvedBy: row.resolved_by, resolvedAt: nullableIso(row.resolved_at), targetPreview: row.target_preview || null,
  targetStatus: row.target_status || null, createdAt: iso(row.created_at),
});
const mapBlockedUser = (row: BlockedUserRow) => ({
  userId: row.id, nickname: row.nickname, blockedAt: iso(row.created_at),
});

function queryOf(request: FastifyRequest) { return (request.query || {}) as Record<string, unknown>; }

async function assertReportTarget(client: DatabaseClient, targetType: ReportRow["target_type"], targetId: string, reporterId: string) {
  if (targetType === "USER" && targetId === reporterId) throw badRequest("자신의 계정은 신고할 수 없습니다.");
  const queries: Record<ReportRow["target_type"], string> = {
    POST: "SELECT id FROM community_posts WHERE id=$1 AND author_id<>$2 AND kind<>'SNAP' AND status='ACTIVE' FOR SHARE",
    SNAP: "SELECT id FROM community_posts WHERE id=$1 AND author_id<>$2 AND kind='SNAP' AND status='ACTIVE' FOR SHARE",
    COMMENT: "SELECT id FROM community_comments WHERE id=$1 AND author_id<>$2 AND status='ACTIVE' FOR SHARE",
    USER: "SELECT id FROM users WHERE id=$1 AND role='USER' AND status<>'DELETED' FOR SHARE",
    EXCHANGE_LISTING: "SELECT id FROM exchange_listings WHERE id=$1 AND author_id<>$2 AND status IN ('OPEN','MATCHED') FOR SHARE",
  };
  const target = await client.query(queries[targetType], targetType === "USER" ? [targetId] : [targetId, reporterId]);
  if (!target.rowCount) throw notFound("신고할 수 있는 대상을 찾을 수 없습니다.");
}

async function reportSubjectUserId(client: DatabaseClient, report: Pick<ReportRow, "target_type" | "target_id">) {
  if (report.target_type === "USER") return report.target_id;
  const queries: Record<Exclude<ReportRow["target_type"], "USER">, string> = {
    POST: "SELECT author_id AS user_id FROM community_posts WHERE id=$1",
    SNAP: "SELECT author_id AS user_id FROM community_posts WHERE id=$1",
    COMMENT: "SELECT author_id AS user_id FROM community_comments WHERE id=$1",
    EXCHANGE_LISTING: "SELECT author_id AS user_id FROM exchange_listings WHERE id=$1",
  };
  const result = await client.query<{ user_id: string }>(queries[report.target_type], [report.target_id]);
  if (!result.rowCount) throw notFound("신고 대상 작성자를 찾을 수 없습니다.");
  return result.rows[0]!.user_id;
}

function noticeInput(body: unknown) {
  const input = objectInput(body);
  return {
    title: stringInput(input, "title", { max: 160 })!,
    content: stringInput(input, "content", { max: 30_000 })!,
    isPinned: booleanInput(input, "isPinned")!,
    isPublished: booleanInput(input, "isPublished")!,
    expectedVersion: input.expectedVersion === undefined ? undefined : Number(input.expectedVersion),
  };
}

const postSelect = (viewerParameter = "NULL::uuid") => `
  SELECT p.*, u.nickname AS author_nickname,
    (SELECT count(*) FROM content_reports r WHERE r.target_type IN ('POST','SNAP') AND r.target_id=p.id) AS report_count,
    (SELECT count(*) FROM community_comments c
      WHERE c.post_id=p.id AND c.status='ACTIVE' AND ${blockVisibility(viewerParameter, "c.author_id")}) AS comment_count,
    (SELECT count(*) FROM community_post_likes l
      WHERE l.post_id=p.id AND ${blockVisibility(viewerParameter, "l.user_id")}) AS like_count,
    (${viewerParameter} IS NOT NULL AND EXISTS(
      SELECT 1 FROM community_post_likes viewer_like
      WHERE viewer_like.post_id=p.id AND viewer_like.user_id=${viewerParameter}
    )) AS liked_by_viewer,
    COALESCE((SELECT array_agg(pm.media_id ORDER BY pm.sort_order,pm.media_id) FROM community_post_media pm WHERE pm.post_id=p.id),'{}'::uuid[]) AS media_ids
  FROM community_posts p JOIN users u ON u.id=p.author_id`;
const inquiryMessageSelect = `
  SELECT m.*,
    COALESCE((SELECT array_agg(mm.media_id ORDER BY mm.media_id) FROM inquiry_message_media mm WHERE mm.message_id=m.id),'{}'::uuid[]) AS media_ids
  FROM inquiry_messages m`;
const commentSelect = `
  SELECT c.*,u.nickname AS author_nickname,
    (SELECT count(*) FROM content_reports r WHERE r.target_type='COMMENT' AND r.target_id=c.id) AS report_count
  FROM community_comments c JOIN users u ON u.id=c.author_id`;

function blockVisibility(viewerParameter: string, authorExpression: string) {
  return `(${viewerParameter}::uuid IS NULL OR NOT EXISTS(
    SELECT 1 FROM user_blocks visibility_block
    WHERE (visibility_block.blocker_id=${viewerParameter} AND visibility_block.blocked_id=${authorExpression})
       OR (visibility_block.blocker_id=${authorExpression} AND visibility_block.blocked_id=${viewerParameter})
  ))`;
}

async function optionalUserId(context: ApiContext, request: FastifyRequest): Promise<string | null> {
  if (!request.headers.authorization) return null;
  try {
    const actor = await context.auth.loadActor(request);
    return actor.sessionKind === "USER" && actor.role === "USER" ? actor.userId : null;
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) return null;
    throw error;
  }
}

async function fetchPost(queryable: Queryable, postId: string, viewerId: string | null, activeOnly = true) {
  const result = await queryable.query<PostRow>(
    `${postSelect("$1::uuid")} WHERE p.id=$2${activeOnly ? " AND p.status='ACTIVE'" : ""}`,
    [viewerId, postId],
  );
  if (!result.rowCount) throw notFound("게시물을 찾을 수 없습니다.");
  return mapPost(result.rows[0]!);
}

async function idempotentMutation<T>(
  context: ApiContext,
  request: FastifyRequest,
  input: {
    scope: string;
    payload: unknown;
    resourceType: string;
    work: (client: DatabaseClient) => Promise<{ statusCode: number; body: T; resourceId: string }>;
  },
) {
  const key = idempotencyKey(request.headers);
  return withTransaction(context.pool, async (client) => {
    const started = await beginIdempotency(client, {
      actorId: request.actor!.userId,
      scope: input.scope,
      key,
      hash: requestHash(input.payload),
    });
    if (!started.fresh) return { replay: true, statusCode: started.statusCode, body: started.body as T };
    const result = await input.work(client);
    await completeIdempotency(client, started.id, {
      statusCode: result.statusCode,
      body: result.body,
      resourceType: input.resourceType,
      resourceId: result.resourceId,
    });
    return { replay: false, statusCode: result.statusCode, body: result.body };
  });
}

function sendMutation<T>(reply: FastifyReply, result: { replay: boolean; statusCode: number; body: T }) {
  if (result.replay) reply.header("x-idempotent-replay", "true");
  return reply.code(result.statusCode).send(result.body);
}

function communityPostPatch(body: unknown) {
  const input = objectInput(body);
  const expectedVersion = integerInput(input, "expectedVersion", { min: 1 })!;
  const title = stringInput(input, "title", { max: 160, optional: true });
  const content = stringInput(input, "content", { max: 20_000, optional: true });
  const ipId = nullableStringInput(input, "ipId", { max: 120 });
  const mediaIds = stringArrayInput(input, "mediaIds", 10, true)?.map((value) => uuidInput(value, "mediaId"));
  if (title === undefined && content === undefined && ipId === undefined && mediaIds === undefined) {
    throw badRequest("수정할 게시물 값을 보내 주세요.");
  }
  return { expectedVersion, title, content, ipId, mediaIds };
}

export async function registerCommunityRoutes(app: FastifyInstance, context: ApiContext) {
  app.get("/v1/notices", async (request) => {
    const query=queryOf(request); const {limit,cursor}=pagination(query); const values:unknown[]=[limit+1];
    const filters=["is_published=true","status='ACTIVE'","published_at<=now()"];
    if(cursor){const pinned=cursor.sort==="1";values.push(pinned,cursor.createdAt,cursor.id);filters.push(`(is_pinned,created_at,id)<($${values.length-2},$${values.length-1},$${values.length})`);}
    const result=await context.pool.query<NoticeRow>(`SELECT * FROM notices WHERE ${filters.join(" AND ")} ORDER BY is_pinned DESC,created_at DESC,id DESC LIMIT $1`,values);
    return cursorPage(result.rows,limit,mapNotice,(row)=>row.is_pinned?"1":"0");
  });

  app.post("/v1/inquiries",{preHandler:context.auth.requireUser},async(request,reply)=>{
    const input=objectInput(request.body);const category=enumInput(input,"category",["ACCOUNT","ERROR","PRODUCT","COMMUNITY","ORDER","OTHER"] as const)!;
    const title=stringInput(input,"title",{max:160})!;const content=stringInput(input,"content",{max:10_000})!;
    const normalizedMediaIds=(stringArrayInput(input,"mediaIds",5,true)||[]).map((value)=>uuidInput(value,"mediaId"));const key=idempotencyKey(request.headers);const hash=requestHash({category,title,content,mediaIds:normalizedMediaIds});
    const result=await withTransaction(context.pool,async(client)=>{
      const idem=await beginIdempotency(client,{actorId:request.actor!.userId,scope:"CREATE_INQUIRY",key,hash});if(!idem.fresh)return{replay:true,statusCode:idem.statusCode,body:idem.body};
      await assertReadyOwnedMedia(client,request.actor!.userId,normalizedMediaIds,["INQUIRY"]);
      const created=await client.query<InquiryRow>("INSERT INTO inquiries(user_id,category,title) VALUES($1,$2,$3) RETURNING *",[request.actor!.userId,category,title]);
      const row=created.rows[0]!;const message=await client.query<{id:string}>("INSERT INTO inquiry_messages(inquiry_id,author_id,author_role,content) VALUES($1,$2,'USER',$3) RETURNING id",[row.id,request.actor!.userId,content]);
      for(const mediaId of normalizedMediaIds)await client.query("INSERT INTO inquiry_message_media(message_id,media_id) VALUES($1,$2)",[message.rows[0]!.id,mediaId]);
      await writeOutbox(client,request.id,{aggregateType:"INQUIRY",aggregateId:row.id,eventType:"inquiry.created",payload:{inquiryId:row.id,userId:row.user_id}});
      const body=mapInquiry(row);await completeIdempotency(client,idem.id,{statusCode:201,body,resourceType:"INQUIRY",resourceId:row.id});return{replay:false,statusCode:201,body};
    });
    if(result.replay)reply.header("x-idempotent-replay","true");return reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/inquiries",{preHandler:context.auth.requireUser},async(request)=>{
    const query=queryOf(request);const {limit,cursor}=pagination(query);const values:unknown[]=[request.actor!.userId,limit+1];const filters=["user_id=$1"];
    if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(created_at,id)<($${values.length-1},$${values.length})`);}
    const result=await context.pool.query<InquiryRow>(`SELECT * FROM inquiries WHERE ${filters.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT $2`,values);
    return cursorPage(result.rows,limit,mapInquiry);
  });

  app.get("/v1/inquiries/:inquiryId",{preHandler:context.auth.requireUser},async(request)=>{
    const id=uuidInput((request.params as Record<string,unknown>).inquiryId,"inquiryId");
    const inquiry=await context.pool.query<InquiryRow>("SELECT * FROM inquiries WHERE id=$1 AND user_id=$2",[id,request.actor!.userId]);if(!inquiry.rowCount)throw notFound();
    const messages=await context.pool.query<InquiryMessageRow>(`${inquiryMessageSelect} WHERE m.inquiry_id=$1 AND m.is_internal=false ORDER BY m.created_at,m.id`,[id]);
    return {...mapInquiry(inquiry.rows[0]!),messages:messages.rows.map(mapInquiryMessage)};
  });

  app.post("/v1/inquiries/:inquiryId/messages",{preHandler:context.auth.requireUser},async(request,reply)=>{
    const id=uuidInput((request.params as Record<string,unknown>).inquiryId,"inquiryId");const body=objectInput(request.body);const content=stringInput(body,"content",{max:10_000})!;
    const mediaIds=(stringArrayInput(body,"mediaIds",5,true)||[]).map((value)=>uuidInput(value,"mediaId"));
    const result=await idempotentMutation(context,request,{
      scope:"CREATE_INQUIRY_USER_MESSAGE",payload:{inquiryId:id,content,mediaIds},resourceType:"INQUIRY_MESSAGE",
      work:async(client)=>{
        const inquiry=await client.query<InquiryRow>("SELECT * FROM inquiries WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,request.actor!.userId]);if(!inquiry.rowCount)throw notFound();
        if(inquiry.rows[0]!.status==="CLOSED")throw conflict("종료된 문의에는 메시지를 추가할 수 없습니다.");
        await assertReadyOwnedMedia(client,request.actor!.userId,mediaIds,["INQUIRY"]);
        const created=await client.query<{id:string}>("INSERT INTO inquiry_messages(inquiry_id,author_id,author_role,content) VALUES($1,$2,'USER',$3) RETURNING id",[id,request.actor!.userId,content]);
        for(const mediaId of mediaIds)await client.query("INSERT INTO inquiry_message_media(message_id,media_id) VALUES($1,$2)",[created.rows[0]!.id,mediaId]);
        await client.query("UPDATE inquiries SET status='IN_PROGRESS' WHERE id=$1",[id]);
        await writeOutbox(client,request.id,{aggregateType:"INQUIRY",aggregateId:id,eventType:"inquiry.user_replied",payload:{inquiryId:id}});
        const message=await client.query<InquiryMessageRow>(`${inquiryMessageSelect} WHERE m.id=$1`,[created.rows[0]!.id]);
        return{statusCode:201,body:mapInquiryMessage(message.rows[0]!),resourceId:created.rows[0]!.id};
      },
    });
    return sendMutation(reply,result);
  });

  app.get("/v1/community/posts", async (request) => {
    const viewerId = await optionalUserId(context, request);
    const query = queryOf(request);
    const { limit, cursor } = pagination(query);
    const search = queryString(query.q);
    const values: unknown[] = [viewerId, limit + 1];
    const filters = ["p.status='ACTIVE'", blockVisibility("$1", "p.author_id")];
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(p.title ILIKE $${values.length} OR p.content ILIKE $${values.length})`);
    }
    if (query.ipId) {
      values.push(stringInput(query, "ipId", { max: 120 })!);
      filters.push(`p.ip_id=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(p.created_at,p.id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<PostRow>(
      `${postSelect("$1::uuid")} WHERE ${filters.join(" AND ")} ORDER BY p.created_at DESC,p.id DESC LIMIT $2`,
      values,
    );
    return cursorPage(result.rows, limit, mapPost);
  });

  app.post("/v1/community/posts", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  }, async(request,reply)=>{
    const input=objectInput(request.body);const kind=enumInput(input,"kind",["DUKROOM","SNAP","GENERAL"] as const)!;const title=stringInput(input,"title",{max:160})!;const content=stringInput(input,"content",{max:20_000})!;
    const ipId=nullableStringInput(input,"ipId",{max:120});const normalizedMediaIds=(stringArrayInput(input,"mediaIds",10,true)||[]).map((value)=>uuidInput(value,"mediaId"));const key=idempotencyKey(request.headers);const hash=requestHash({kind,title,content,ipId:ipId||null,mediaIds:normalizedMediaIds});
    const result=await withTransaction(context.pool,async(client)=>{const idem=await beginIdempotency(client,{actorId:request.actor!.userId,scope:"CREATE_COMMUNITY_POST",key,hash});if(!idem.fresh)return{replay:true,statusCode:idem.statusCode,body:idem.body};await assertReadyOwnedMedia(client,request.actor!.userId,normalizedMediaIds,["POST"]);const created=await client.query<{id:string}>("INSERT INTO community_posts(author_id,ip_id,kind,title,content) VALUES($1,$2,$3,$4,$5) RETURNING id",[request.actor!.userId,ipId||null,kind,title,content]);
      for(const [index,mediaId] of normalizedMediaIds.entries())await client.query("INSERT INTO community_post_media(post_id,media_id,sort_order) VALUES($1,$2,$3)",[created.rows[0]!.id,mediaId,index]);const saved=await client.query<PostRow>(`${postSelect()} WHERE p.id=$1`,[created.rows[0]!.id]);const body=mapPost(saved.rows[0]!);await completeIdempotency(client,idem.id,{statusCode:201,body,resourceType:"COMMUNITY_POST",resourceId:created.rows[0]!.id});return{replay:false,statusCode:201,body};});if(result.replay)reply.header("x-idempotent-replay","true");return reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/community/posts/:postId", async (request) => {
    const postId = uuidInput((request.params as Record<string, unknown>).postId, "postId");
    const viewerId = await optionalUserId(context, request);
    const result = await context.pool.query<PostRow>(
      `${postSelect("$1::uuid")} WHERE p.id=$2 AND p.status='ACTIVE' AND ${blockVisibility("$1", "p.author_id")}`,
      [viewerId, postId],
    );
    if (!result.rowCount) throw notFound("게시물을 찾을 수 없습니다.");
    return mapPost(result.rows[0]!);
  });

  app.patch("/v1/community/posts/:postId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const postId = uuidInput((request.params as Record<string, unknown>).postId, "postId");
    const input = communityPostPatch(request.body);
    const result = await idempotentMutation(context, request, {
      scope: "COMMUNITY_POST_UPDATE",
      payload: { postId, ...input },
      resourceType: "COMMUNITY_POST",
      work: async (client) => {
        const before = await client.query<{
          author_id: string; status: PostRow["status"]; version: number; title: string; content: string; ip_id: string | null;
        }>("SELECT author_id,status,version,title,content,ip_id FROM community_posts WHERE id=$1 FOR UPDATE", [postId]);
        if (!before.rowCount) throw notFound("게시물을 찾을 수 없습니다.");
        const current = before.rows[0]!;
        if (current.author_id !== request.actor!.userId) throw forbidden();
        if (current.status !== "ACTIVE") throw conflict("공개 중인 게시물만 수정할 수 있습니다.");
        if (current.version !== input.expectedVersion) throw conflict("게시물이 다른 기기에서 먼저 수정되었습니다.");
        if (input.ipId) {
          const ip = await client.query("SELECT 1 FROM catalog_ips WHERE id=$1 AND is_active=true", [input.ipId]);
          if (!ip.rowCount) throw badRequest("게시물의 작품 IP를 찾을 수 없습니다.");
        }
        if (input.mediaIds !== undefined) {
          await assertReadyOwnedMedia(client, request.actor!.userId, input.mediaIds, ["POST"]);
        }
        const updated = await client.query(
          `UPDATE community_posts SET title=$2,content=$3,ip_id=$4,version=version+1
           WHERE id=$1 AND version=$5 AND status='ACTIVE' RETURNING id`,
          [
            postId,
            input.title ?? current.title,
            input.content ?? current.content,
            input.ipId === undefined ? current.ip_id : input.ipId,
            input.expectedVersion,
          ],
        );
        if (!updated.rowCount) throw conflict("게시물이 다른 기기에서 먼저 수정되었습니다.");
        if (input.mediaIds !== undefined) {
          await client.query("DELETE FROM community_post_media WHERE post_id=$1", [postId]);
          for (const [index, mediaId] of input.mediaIds.entries()) {
            await client.query(
              "INSERT INTO community_post_media(post_id,media_id,sort_order) VALUES($1,$2,$3)",
              [postId, mediaId, index],
            );
          }
        }
        await writeOutbox(client, request.id, {
          aggregateType: "COMMUNITY_POST",
          aggregateId: postId,
          eventType: "community.post.updated",
          payload: { postId, authorId: request.actor!.userId },
        });
        return {
          statusCode: 200,
          body: await fetchPost(client, postId, request.actor!.userId),
          resourceId: postId,
        };
      },
    });
    return sendMutation(reply, result);
  });

  app.delete("/v1/community/posts/:postId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const postId = uuidInput((request.params as Record<string, unknown>).postId, "postId");
    const body = objectInput(request.body);
    const expectedVersion = integerInput(body, "expectedVersion", { min: 1 })!;
    const result = await idempotentMutation(context, request, {
      scope: "COMMUNITY_POST_DELETE",
      payload: { postId, expectedVersion },
      resourceType: "COMMUNITY_POST",
      work: async (client) => {
        const before = await client.query<{ author_id: string; status: PostRow["status"]; version: number }>(
          "SELECT author_id,status,version FROM community_posts WHERE id=$1 FOR UPDATE",
          [postId],
        );
        if (!before.rowCount) throw notFound("게시물을 찾을 수 없습니다.");
        const current = before.rows[0]!;
        if (current.author_id !== request.actor!.userId) throw forbidden();
        if (current.status === "DELETED") throw conflict("이미 삭제된 게시물입니다.");
        if (current.version !== expectedVersion) throw conflict("게시물이 다른 기기에서 먼저 수정되었습니다.");
        const deleted = await client.query<{ version: number }>(
          `UPDATE community_posts SET status='DELETED',deleted_at=now(),version=version+1
           WHERE id=$1 AND version=$2 AND status<>'DELETED' RETURNING version`,
          [postId, expectedVersion],
        );
        if (!deleted.rowCount) throw conflict("게시물이 다른 기기에서 먼저 수정되었습니다.");
        const response = { postId, status: "DELETED" as const, version: deleted.rows[0]!.version };
        await writeOutbox(client, request.id, {
          aggregateType: "COMMUNITY_POST",
          aggregateId: postId,
          eventType: "community.post.deleted",
          payload: { postId, authorId: request.actor!.userId },
        });
        return { statusCode: 200, body: response, resourceId: postId };
      },
    });
    return sendMutation(reply, result);
  });

  app.post("/v1/community/posts/:postId/like", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const postId = uuidInput((request.params as Record<string, unknown>).postId, "postId");
    const body = objectInput(request.body);
    const liked = booleanInput(body, "liked")!;
    const result = await idempotentMutation(context, request, {
      scope: "COMMUNITY_POST_LIKE",
      payload: { postId, liked },
      resourceType: "COMMUNITY_POST",
      work: async (client) => {
        const post = await client.query<{ author_id: string }>(
          `SELECT p.author_id FROM community_posts p
           WHERE p.id=$2 AND p.status='ACTIVE' AND ${blockVisibility("$1", "p.author_id")}
           FOR SHARE OF p`,
          [request.actor!.userId, postId],
        );
        if (!post.rowCount) throw notFound("게시물을 찾을 수 없습니다.");
        if (post.rows[0]!.author_id === request.actor!.userId) {
          throw forbidden("자신의 게시물에는 좋아요를 누를 수 없습니다.");
        }
        const changed = liked
          ? await client.query(
              "INSERT INTO community_post_likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING post_id",
              [postId, request.actor!.userId],
            )
          : await client.query(
              "DELETE FROM community_post_likes WHERE post_id=$1 AND user_id=$2 RETURNING post_id",
              [postId, request.actor!.userId],
            );
        const count = await client.query<{ count: string }>(
          "SELECT count(*) FROM community_post_likes WHERE post_id=$1",
          [postId],
        );
        if (changed.rowCount) {
          await writeOutbox(client, request.id, {
            aggregateType: "COMMUNITY_POST",
            aggregateId: postId,
            eventType: liked ? "community.post.liked" : "community.post.unliked",
            payload: { postId, userId: request.actor!.userId },
          });
        }
        return {
          statusCode: 200,
          body: { postId, liked, likeCount: Number(count.rows[0]!.count) },
          resourceId: postId,
        };
      },
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/community/posts/:postId/comments", async (request) => {
    const postId = uuidInput((request.params as Record<string, unknown>).postId, "postId");
    const viewerId = await optionalUserId(context, request);
    const query = queryOf(request);
    const { limit, cursor } = pagination(query);
    const post = await context.pool.query(
      `SELECT 1 FROM community_posts p
       WHERE p.id=$2 AND p.status='ACTIVE' AND ${blockVisibility("$1", "p.author_id")}`,
      [viewerId, postId],
    );
    if (!post.rowCount) throw notFound("게시물을 찾을 수 없습니다.");
    const values: unknown[] = [viewerId, postId, limit + 1];
    const filters = ["c.post_id=$2", "c.status='ACTIVE'", blockVisibility("$1", "c.author_id")];
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(c.created_at,c.id)>($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<CommentRow>(
      `${commentSelect} WHERE ${filters.join(" AND ")} ORDER BY c.created_at,c.id LIMIT $3`,
      values,
    );
    return cursorPage(result.rows, limit, mapComment);
  });

  app.post("/v1/community/posts/:postId/comments", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const postId = uuidInput((request.params as Record<string, unknown>).postId, "postId");
    const body = objectInput(request.body);
    const content = stringInput(body, "content", { max: 2000 })!;
    const result = await idempotentMutation(context, request, {
      scope: "COMMUNITY_COMMENT_CREATE",
      payload: { postId, content },
      resourceType: "COMMUNITY_COMMENT",
      work: async (client) => {
        const post = await client.query(
          `SELECT p.id FROM community_posts p
           WHERE p.id=$2 AND p.status='ACTIVE' AND ${blockVisibility("$1", "p.author_id")}
           FOR SHARE OF p`,
          [request.actor!.userId, postId],
        );
        if (!post.rowCount) throw notFound("게시물을 찾을 수 없습니다.");
        const created = await client.query<{ id: string }>(
          "INSERT INTO community_comments(post_id,author_id,content) VALUES($1,$2,$3) RETURNING id",
          [postId, request.actor!.userId, content],
        );
        const commentId = created.rows[0]!.id;
        const saved = await client.query<CommentRow>(`${commentSelect} WHERE c.id=$1`, [commentId]);
        const response = mapComment(saved.rows[0]!);
        await writeOutbox(client, request.id, {
          aggregateType: "COMMUNITY_POST",
          aggregateId: postId,
          eventType: "community.comment.created",
          payload: { postId, commentId, authorId: request.actor!.userId },
        });
        return { statusCode: 201, body: response, resourceId: commentId };
      },
    });
    return sendMutation(reply, result);
  });

  app.delete("/v1/community/comments/:commentId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const commentId = uuidInput((request.params as Record<string, unknown>).commentId, "commentId");
    const result = await idempotentMutation(context, request, {
      scope: "COMMUNITY_COMMENT_DELETE",
      payload: { commentId },
      resourceType: "COMMUNITY_COMMENT",
      work: async (client) => {
        const before = await client.query<{ post_id: string; author_id: string; status: CommentRow["status"] }>(
          "SELECT post_id,author_id,status FROM community_comments WHERE id=$1 FOR UPDATE",
          [commentId],
        );
        if (!before.rowCount) throw notFound("댓글을 찾을 수 없습니다.");
        const current = before.rows[0]!;
        if (current.author_id !== request.actor!.userId) throw forbidden();
        if (current.status === "DELETED") throw conflict("이미 삭제된 댓글입니다.");
        await client.query(
          "UPDATE community_comments SET status='DELETED',deleted_at=now() WHERE id=$1 AND status<>'DELETED'",
          [commentId],
        );
        const response = { commentId, status: "DELETED" as const };
        await writeOutbox(client, request.id, {
          aggregateType: "COMMUNITY_POST",
          aggregateId: current.post_id,
          eventType: "community.comment.deleted",
          payload: { postId: current.post_id, commentId, authorId: request.actor!.userId },
        });
        return { statusCode: 200, body: response, resourceId: commentId };
      },
    });
    return sendMutation(reply, result);
  });

  app.get("/v1/community/blocks", { preHandler: context.auth.requireUser }, async (request) => {
    const query = queryOf(request);
    const { limit, cursor } = pagination(query);
    const values: unknown[] = [request.actor!.userId, limit + 1];
    const filters = ["b.blocker_id=$1"];
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      filters.push(`(b.created_at,b.blocked_id)<($${values.length - 1},$${values.length})`);
    }
    const result = await context.pool.query<BlockedUserRow>(
      `SELECT b.blocked_id AS id,
         CASE WHEN u.status='DELETED' THEN '탈퇴한 사용자' ELSE u.nickname END AS nickname,
         b.created_at
       FROM user_blocks b JOIN users u ON u.id=b.blocked_id
       WHERE ${filters.join(" AND ")}
       ORDER BY b.created_at DESC,b.blocked_id DESC LIMIT $2`,
      values,
    );
    return cursorPage(result.rows, limit, mapBlockedUser);
  });

  app.post("/v1/community/blocks/:userId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const userId = uuidInput((request.params as Record<string, unknown>).userId, "userId");
    if (userId === request.actor!.userId) throw badRequest("자신의 계정은 차단할 수 없습니다.");
    const result = await idempotentMutation(context, request, {
      scope: "COMMUNITY_USER_BLOCK",
      payload: { userId },
      resourceType: "USER_BLOCK",
      work: async (client) => {
        const target = await client.query(
          "SELECT id FROM users WHERE id=$1 AND role='USER' AND status<>'DELETED' FOR SHARE",
          [userId],
        );
        if (!target.rowCount) throw notFound("차단할 사용자를 찾을 수 없습니다.");
        await client.query(
          "INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [request.actor!.userId, userId],
        );
        return { statusCode: 200, body: { userId, blocked: true }, resourceId: userId };
      },
    });
    return sendMutation(reply, result);
  });

  app.delete("/v1/community/blocks/:userId", {
    preHandler: context.auth.requireUser,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const userId = uuidInput((request.params as Record<string, unknown>).userId, "userId");
    if (userId === request.actor!.userId) throw badRequest("자신의 계정은 차단 해제 대상이 될 수 없습니다.");
    const result = await idempotentMutation(context, request, {
      scope: "COMMUNITY_USER_UNBLOCK",
      payload: { userId },
      resourceType: "USER_BLOCK",
      work: async (client) => {
        await client.query("DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2", [request.actor!.userId, userId]);
        return { statusCode: 200, body: { userId, blocked: false }, resourceId: userId };
      },
    });
    return sendMutation(reply, result);
  });

  app.post("/v1/reports",{preHandler:context.auth.requireUser},async(request,reply)=>{const input=objectInput(request.body);const targetType=enumInput(input,"targetType",["POST","COMMENT","SNAP","USER","EXCHANGE_LISTING"] as const)!;const targetId=uuidInput(input.targetId,"targetId");const reason=enumInput(input,"reason",["ABUSE","ADVERTISING","SPAM","INAPPROPRIATE","SUSPECTED_FRAUD","COPYRIGHT","OTHER"] as const)!;const details=nullableStringInput(input,"details",{max:2000});
    const key=idempotencyKey(request.headers);const hash=requestHash({targetType,targetId,reason,details:details||null});const result=await withTransaction(context.pool,async(client)=>{const idem=await beginIdempotency(client,{actorId:request.actor!.userId,scope:"CREATE_REPORT",key,hash});if(!idem.fresh)return{replay:true,statusCode:idem.statusCode,body:idem.body};await assertReportTarget(client,targetType,targetId,request.actor!.userId);const created=await client.query<ReportRow>("INSERT INTO content_reports(reporter_id,target_type,target_id,reason,details) VALUES($1,$2,$3,$4,$5) RETURNING *",[request.actor!.userId,targetType,targetId,reason,details||null]);const body=mapReport(created.rows[0]!);await completeIdempotency(client,idem.id,{statusCode:201,body,resourceType:"REPORT",resourceId:created.rows[0]!.id});return{replay:false,statusCode:201,body};});if(result.replay)reply.header("x-idempotent-replay","true");return reply.code(result.statusCode).send(result.body);});

  app.get("/v1/admin/notices",{preHandler:context.auth.requirePermission("notices.read")},async(request)=>{const query=queryOf(request);const {limit,cursor}=pagination(query);const search=queryString(query.q);const values:unknown[]=[limit+1];const filters:string[]=[];if(search){values.push(`%${search}%`);filters.push(`(title ILIKE $${values.length} OR content ILIKE $${values.length})`);}if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(created_at,id)<($${values.length-1},$${values.length})`);}const result=await context.pool.query<NoticeRow>(`SELECT * FROM notices ${filters.length?`WHERE ${filters.join(" AND ")}`:""} ORDER BY created_at DESC,id DESC LIMIT $1`,values);return cursorPage(result.rows,limit,mapNotice);});

  app.post("/v1/admin/notices",{preHandler:context.auth.requirePermission("notices.write")},async(request,reply)=>{const input=noticeInput(request.body);const mutation=await adminIdempotentMutation(context,request,{target:{type:"NOTICE",title:input.title},work:async(client)=>{const created=await client.query<NoticeRow>(`INSERT INTO notices(title,content,is_pinned,is_published,created_by,published_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $4 THEN now() ELSE NULL END) RETURNING *`,[input.title,input.content,input.isPinned,input.isPublished,request.actor!.userId]);const value=created.rows[0]!;await client.query("INSERT INTO notice_versions(notice_id,version,title,content,is_pinned,is_published,changed_by,change_reason) VALUES($1,1,$2,$3,$4,$5,$6,'create')",[value.id,value.title,value.content,value.is_pinned,value.is_published,request.actor!.userId]);await writeAdminAudit(client,request,request.actor!,{action:"NOTICE_CREATED",targetType:"NOTICE",targetId:value.id,after:value});await writeOutbox(client,request.id,{aggregateType:"NOTICE",aggregateId:value.id,eventType:value.is_published?"notice.published":"notice.created",payload:{noticeId:value.id}});return{statusCode:201,body:mapNotice(value),resourceType:"NOTICE",resourceId:value.id};}});return sendAdminMutation(reply,mutation);});

  app.patch("/v1/admin/notices/:noticeId",{preHandler:context.auth.requirePermission("notices.write")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).noticeId,"noticeId");const input=noticeInput(request.body);if(!Number.isInteger(input.expectedVersion)||input.expectedVersion!<1)throw badRequest("expectedVersion 값이 필요합니다.");const mutation=await adminIdempotentMutation(context,request,{target:{type:"NOTICE",id},work:async(client)=>{const before=await client.query<NoticeRow>("SELECT * FROM notices WHERE id=$1 FOR UPDATE",[id]);if(!before.rowCount)throw notFound();if(before.rows[0]!.status==="HIDDEN"&&input.isPublished)throw conflict("숨김을 먼저 해제한 뒤 게시해 주세요.");const updated=await client.query<NoticeRow>(`UPDATE notices SET title=$2,content=$3,is_pinned=$4,is_published=$5,published_at=CASE WHEN $5 AND published_at IS NULL THEN now() WHEN NOT $5 THEN NULL ELSE published_at END,version=version+1 WHERE id=$1 AND version=$6 AND status<>'DELETED' RETURNING *`,[id,input.title,input.content,input.isPinned,input.isPublished,input.expectedVersion]);if(!updated.rowCount)throw conflict("다른 운영자가 먼저 수정했습니다.");const value=updated.rows[0]!;await client.query("INSERT INTO notice_versions(notice_id,version,title,content,is_pinned,is_published,changed_by,change_reason) VALUES($1,$2,$3,$4,$5,$6,$7,'update')",[id,value.version,value.title,value.content,value.is_pinned,value.is_published,request.actor!.userId]);await writeAdminAudit(client,request,request.actor!,{action:"NOTICE_UPDATED",targetType:"NOTICE",targetId:id,before:before.rows[0],after:value});await writeOutbox(client,request.id,{aggregateType:"NOTICE",aggregateId:id,eventType:value.is_published?"notice.published":"notice.updated",payload:{noticeId:id}});return{statusCode:200,body:mapNotice(value),resourceType:"NOTICE",resourceId:id};}});return sendAdminMutation(reply,mutation);});

  app.post("/v1/admin/notices/:noticeId/visibility",{preHandler:context.auth.requirePermission("notices.write")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).noticeId,"noticeId");const body=objectInput(request.body);const status=enumInput(body,"status",["ACTIVE","HIDDEN"] as const)!;const expectedVersion=Number(body.expectedVersion);if(!Number.isInteger(expectedVersion)||expectedVersion<1)throw badRequest("expectedVersion 값이 필요합니다.");const mutation=await adminIdempotentMutation(context,request,{target:{type:"NOTICE",id},work:async(client)=>{const before=await client.query<NoticeRow>("SELECT * FROM notices WHERE id=$1 FOR UPDATE",[id]);if(!before.rowCount)throw notFound();if(before.rows[0]!.status==="DELETED")throw conflict("삭제된 공지는 복구 작업을 사용해 주세요.");if(before.rows[0]!.status===status)throw conflict("이미 요청한 노출 상태입니다.");const updated=await client.query<NoticeRow>("UPDATE notices SET status=$2,is_published=CASE WHEN $2='HIDDEN' THEN false ELSE is_published END,published_at=CASE WHEN $2='HIDDEN' THEN NULL ELSE published_at END,version=version+1 WHERE id=$1 AND version=$3 RETURNING *",[id,status,expectedVersion]);if(!updated.rowCount)throw conflict("다른 운영자가 먼저 수정했습니다.");const value=updated.rows[0]!;await client.query("INSERT INTO notice_versions(notice_id,version,title,content,is_pinned,is_published,changed_by,change_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[id,value.version,value.title,value.content,value.is_pinned,value.is_published,request.actor!.userId,status==="HIDDEN"?"hide":"unhide"]);await writeAdminAudit(client,request,request.actor!,{action:status==="HIDDEN"?"NOTICE_HIDDEN":"NOTICE_UNHIDDEN",targetType:"NOTICE",targetId:id,before:before.rows[0],after:value});return{statusCode:200,body:mapNotice(value),resourceType:"NOTICE",resourceId:id};}});return sendAdminMutation(reply,mutation);});

  app.delete("/v1/admin/notices/:noticeId",{preHandler:context.auth.requirePermission("notices.write")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).noticeId,"noticeId");const body=objectInput(request.body);const expectedVersion=Number(body.expectedVersion);if(!Number.isInteger(expectedVersion)||expectedVersion<1)throw badRequest("expectedVersion 값이 필요합니다.");const mutation=await adminIdempotentMutation(context,request,{target:{type:"NOTICE",id},work:async(client)=>{const before=await client.query<NoticeRow>("SELECT * FROM notices WHERE id=$1 FOR UPDATE",[id]);if(!before.rowCount)throw notFound();const deleted=await client.query("UPDATE notices SET status='DELETED',is_published=false,deleted_at=now(),version=version+1 WHERE id=$1 AND version=$2 RETURNING id",[id,expectedVersion]);if(!deleted.rowCount)throw conflict("다른 운영자가 먼저 수정했습니다.");await writeAdminAudit(client,request,request.actor!,{action:"NOTICE_SOFT_DELETED",targetType:"NOTICE",targetId:id,before:before.rows[0]});return{statusCode:204,body:{id,status:"DELETED" as const},resourceType:"NOTICE",resourceId:id};}});return sendAdminMutation(reply,mutation);});

  app.post("/v1/admin/notices/:noticeId/restore",{preHandler:context.auth.requirePermission("notices.write")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).noticeId,"noticeId");const body=objectInput(request.body);const expectedVersion=Number(body.expectedVersion);if(!Number.isInteger(expectedVersion)||expectedVersion<1)throw badRequest("expectedVersion 값이 필요합니다.");const mutation=await adminIdempotentMutation(context,request,{target:{type:"NOTICE",id},work:async(client)=>{const before=await client.query<NoticeRow>("SELECT * FROM notices WHERE id=$1 FOR UPDATE",[id]);if(!before.rowCount)throw notFound();if(before.rows[0]!.status!=="DELETED")throw conflict("삭제된 공지만 복구할 수 있습니다.");const restored=await client.query<NoticeRow>("UPDATE notices SET status='ACTIVE',is_published=false,published_at=NULL,deleted_at=NULL,version=version+1 WHERE id=$1 AND version=$2 RETURNING *",[id,expectedVersion]);if(!restored.rowCount)throw conflict("다른 운영자가 먼저 수정했습니다.");const value=restored.rows[0]!;await client.query("INSERT INTO notice_versions(notice_id,version,title,content,is_pinned,is_published,changed_by,change_reason) VALUES($1,$2,$3,$4,$5,$6,$7,'restore')",[id,value.version,value.title,value.content,value.is_pinned,value.is_published,request.actor!.userId]);await writeAdminAudit(client,request,request.actor!,{action:"NOTICE_RESTORED",targetType:"NOTICE",targetId:id,before:before.rows[0],after:value});await writeOutbox(client,request.id,{aggregateType:"NOTICE",aggregateId:id,eventType:"notice.restored",payload:{noticeId:id}});return{statusCode:200,body:mapNotice(value),resourceType:"NOTICE",resourceId:id};}});return sendAdminMutation(reply,mutation);});

  app.get("/v1/admin/inquiries",{preHandler:context.auth.requirePermission("inquiries.read")},async(request)=>{const query=queryOf(request);const {limit,cursor}=pagination(query);const search=queryString(query.q);const status=query.status===undefined?undefined:enumInput(query,"status",INQUIRY_STATUSES);const userId=query.userId===undefined?undefined:uuidInput(query.userId,"userId");const values:unknown[]=[limit+1];const filters:string[]=[];if(search){values.push(`%${search}%`);filters.push(`(title ILIKE $${values.length} OR category ILIKE $${values.length} OR id::text ILIKE $${values.length} OR user_id::text ILIKE $${values.length})`);}if(status){values.push(status);filters.push(`status=$${values.length}`);}if(userId){values.push(userId);filters.push(`user_id=$${values.length}`);}if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(created_at,id)<($${values.length-1},$${values.length})`);}const result=await context.pool.query<InquiryRow>(`SELECT * FROM inquiries ${filters.length?`WHERE ${filters.join(" AND ")}`:""} ORDER BY created_at DESC,id DESC LIMIT $1`,values);return cursorPage(result.rows,limit,mapInquiry);});

  app.get("/v1/admin/inquiries/:inquiryId",{preHandler:context.auth.requirePermission("inquiries.read")},async(request)=>{const id=uuidInput((request.params as Record<string,unknown>).inquiryId,"inquiryId");const inquiry=await context.pool.query<InquiryRow>("SELECT * FROM inquiries WHERE id=$1",[id]);if(!inquiry.rowCount)throw notFound();const messages=await context.pool.query<InquiryMessageRow>(`${inquiryMessageSelect} WHERE m.inquiry_id=$1 ORDER BY m.created_at,m.id`,[id]);return {...mapInquiry(inquiry.rows[0]!),messages:messages.rows.map(mapInquiryMessage)};});

  app.post("/v1/admin/inquiries/:inquiryId/messages",{preHandler:context.auth.requirePermission("inquiries.reply")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).inquiryId,"inquiryId");const body=objectInput(request.body);const content=stringInput(body,"content",{max:10_000})!;const requestedStatus=body.status===undefined?"ANSWERED":enumInput(body,"status",INQUIRY_STATUSES)!;const isInternal=booleanInput(body,"isInternal",true)||false;const mediaIds=(stringArrayInput(body,"mediaIds",5,true)||[]).map((value)=>uuidInput(value,"mediaId"));const mutation=adminMutationHeaders(request);
    const result=await idempotentMutation(context,request,{scope:"CREATE_ADMIN_INQUIRY_MESSAGE",payload:{inquiryId:id,content,requestedStatus,isInternal,mediaIds,reason:mutation.reason},resourceType:"INQUIRY_MESSAGE",work:async(client)=>{const inquiry=await client.query<InquiryRow>("SELECT * FROM inquiries WHERE id=$1 FOR UPDATE",[id]);if(!inquiry.rowCount)throw notFound();const status=isInternal?inquiry.rows[0]!.status:requestedStatus;if(!canTransitionInquiry(inquiry.rows[0]!.status,status))throw conflict("허용되지 않는 문의 상태 변경입니다.");await assertReadyOwnedMedia(client,request.actor!.userId,mediaIds,["INQUIRY"]);const created=await client.query<{id:string}>("INSERT INTO inquiry_messages(inquiry_id,author_id,author_role,content,is_internal) VALUES($1,$2,$3,$4,$5) RETURNING id",[id,request.actor!.userId,request.actor!.role,content,isInternal]);for(const mediaId of mediaIds)await client.query("INSERT INTO inquiry_message_media(message_id,media_id) VALUES($1,$2)",[created.rows[0]!.id,mediaId]);await client.query("UPDATE inquiries SET status=$2,assigned_admin_id=COALESCE(assigned_admin_id,$3),closed_at=CASE WHEN $2='CLOSED' THEN now() ELSE NULL END WHERE id=$1",[id,status,request.actor!.userId]);await writeAdminAudit(client,request,request.actor!,{action:isInternal?"INQUIRY_INTERNAL_NOTE_ADDED":"INQUIRY_ANSWERED",targetType:"INQUIRY",targetId:id,after:{status,isInternal,mediaCount:mediaIds.length}});if(!isInternal)await writeOutbox(client,request.id,{aggregateType:"INQUIRY",aggregateId:id,eventType:"inquiry.answered",payload:{inquiryId:id,userId:inquiry.rows[0]!.user_id}});const message=await client.query<InquiryMessageRow>(`${inquiryMessageSelect} WHERE m.id=$1`,[created.rows[0]!.id]);return{statusCode:201,body:mapInquiryMessage(message.rows[0]!),resourceId:created.rows[0]!.id};}});return sendMutation(reply,result);});

  app.get("/v1/admin/posts",{preHandler:context.auth.requirePermission("moderation.read")},async(request)=>{const query=queryOf(request);const {limit,cursor}=pagination(query);const search=queryString(query.q);const status=query.status===undefined?undefined:enumInput(query,"status",CONTENT_STATUSES);const kind=query.kind===undefined?undefined:enumInput(query,"kind",["DUKROOM","SNAP","GENERAL"] as const);const values:unknown[]=[limit+1];const filters:string[]=[];if(search){values.push(`%${search}%`);filters.push(`(p.title ILIKE $${values.length} OR p.content ILIKE $${values.length} OR u.nickname ILIKE $${values.length})`);}if(status){values.push(status);filters.push(`p.status=$${values.length}`);}if(kind){values.push(kind);filters.push(`p.kind=$${values.length}`);}if(query.authorId){values.push(uuidInput(query.authorId,"authorId"));filters.push(`p.author_id=$${values.length}`);}if(query.ipId){values.push(stringInput(query,"ipId",{max:120})!);filters.push(`p.ip_id=$${values.length}`);}if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(p.created_at,p.id)<($${values.length-1},$${values.length})`);}const result=await context.pool.query<PostRow>(`${postSelect()} ${filters.length?`WHERE ${filters.join(" AND ")}`:""} ORDER BY p.created_at DESC,p.id DESC LIMIT $1`,values);return cursorPage(result.rows,limit,mapPost);});

  app.post("/v1/admin/posts/:postId/status",{preHandler:context.auth.requirePermission("moderation.action")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).postId,"postId");const body=objectInput(request.body);const status=enumInput(body,"status",CONTENT_STATUSES)!;const reason=stringInput(body,"reason",{max:1000})!;const mutation=await adminIdempotentMutation(context,request,{target:{type:"POST",id},bodyReason:reason,work:async(client)=>{const before=await client.query<PostRow>(`${postSelect()} WHERE p.id=$1 FOR UPDATE OF p`,[id]);if(!before.rowCount)throw notFound();await client.query("UPDATE community_posts SET status=$2,hidden_reason=$3,deleted_at=CASE WHEN $2='DELETED' THEN now() ELSE NULL END,version=version+1 WHERE id=$1",[id,status,reason]);const after=await client.query<PostRow>(`${postSelect()} WHERE p.id=$1`,[id]);await client.query("INSERT INTO moderation_actions(admin_id,action,target_type,target_id,reason) VALUES($1,$2,'POST',$3,$4)",[request.actor!.userId,status==="ACTIVE"?"RESTORE_POST":"HIDE_POST",id,reason]);await writeAdminAudit(client,request,request.actor!,{action:"POST_STATUS_CHANGED",targetType:"POST",targetId:id,reason,before:before.rows[0],after:after.rows[0]});return{statusCode:200,body:mapPost(after.rows[0]!),resourceType:"POST",resourceId:id};}});return sendAdminMutation(reply,mutation);});

  app.get("/v1/admin/comments",{preHandler:context.auth.requirePermission("moderation.read")},async(request)=>{const query=queryOf(request);const {limit,cursor}=pagination(query);const search=queryString(query.q);const status=query.status===undefined?undefined:enumInput(query,"status",CONTENT_STATUSES);const values:unknown[]=[limit+1];const filters:string[]=[];if(search){values.push(`%${search}%`);filters.push(`(c.content ILIKE $${values.length} OR u.nickname ILIKE $${values.length})`);}if(status){values.push(status);filters.push(`c.status=$${values.length}`);}if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(c.created_at,c.id)<($${values.length-1},$${values.length})`);}const result=await context.pool.query<CommentRow>(`${commentSelect} ${filters.length?`WHERE ${filters.join(" AND ")}`:""} ORDER BY c.created_at DESC,c.id DESC LIMIT $1`,values);return cursorPage(result.rows,limit,mapComment);});

  app.post("/v1/admin/comments/:commentId/status",{preHandler:context.auth.requirePermission("moderation.action")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).commentId,"commentId");const body=objectInput(request.body);const status=enumInput(body,"status",CONTENT_STATUSES)!;const reason=stringInput(body,"reason",{max:1000})!;const mutation=await adminIdempotentMutation(context,request,{target:{type:"COMMENT",id},bodyReason:reason,work:async(client)=>{const before=await client.query<CommentRow>(`${commentSelect} WHERE c.id=$1 FOR UPDATE OF c`,[id]);if(!before.rowCount)throw notFound();await client.query("UPDATE community_comments SET status=$2,hidden_reason=$3,deleted_at=CASE WHEN $2='DELETED' THEN now() ELSE NULL END WHERE id=$1",[id,status,reason]);const after=await client.query<CommentRow>(`${commentSelect} WHERE c.id=$1`,[id]);await client.query("INSERT INTO moderation_actions(admin_id,action,target_type,target_id,reason) VALUES($1,$2,'COMMENT',$3,$4)",[request.actor!.userId,status==="ACTIVE"?"RESTORE_COMMENT":"HIDE_COMMENT",id,reason]);await writeAdminAudit(client,request,request.actor!,{action:"COMMENT_STATUS_CHANGED",targetType:"COMMENT",targetId:id,reason,before:before.rows[0],after:after.rows[0]});return{statusCode:200,body:mapComment(after.rows[0]!),resourceType:"COMMENT",resourceId:id};}});return sendAdminMutation(reply,mutation);});

  app.get("/v1/admin/reports",{preHandler:context.auth.requirePermission("reports.read")},async(request)=>{const query=queryOf(request);const {limit,cursor}=pagination(query);const status=query.status===undefined?undefined:enumInput(query,"status",REPORT_STATUSES);const targetType=query.targetType===undefined?undefined:enumInput(query,"targetType",["POST","COMMENT","SNAP","USER","EXCHANGE_LISTING"] as const);const targetId=query.targetId===undefined?undefined:uuidInput(query.targetId,"targetId");const reporterId=query.reporterId===undefined?undefined:uuidInput(query.reporterId,"reporterId");const subjectUserId=query.subjectUserId===undefined?undefined:uuidInput(query.subjectUserId,"subjectUserId");const values:unknown[]=[limit+1];const filters:string[]=[];if(status){values.push(status);filters.push(`r.status=$${values.length}`);}if(targetType){values.push(targetType);filters.push(`r.target_type=$${values.length}`);}if(targetId){values.push(targetId);filters.push(`r.target_id=$${values.length}`);}if(reporterId){values.push(reporterId);filters.push(`r.reporter_id=$${values.length}`);}if(subjectUserId){values.push(subjectUserId);const parameter=`$${values.length}`;filters.push(`(r.target_type,r.target_id) IN (
      SELECT 'USER'::text,${parameter}::uuid
      UNION ALL SELECT CASE WHEN subject_post.kind='SNAP' THEN 'SNAP' ELSE 'POST' END,subject_post.id FROM community_posts subject_post WHERE subject_post.author_id=${parameter}
      UNION ALL SELECT 'COMMENT',subject_comment.id FROM community_comments subject_comment WHERE subject_comment.author_id=${parameter}
      UNION ALL SELECT 'EXCHANGE_LISTING',subject_listing.id FROM exchange_listings subject_listing WHERE subject_listing.author_id=${parameter}
    )`);}if(cursor){values.push(cursor.createdAt,cursor.id);filters.push(`(r.created_at,r.id)<($${values.length-1},$${values.length})`);}const result=await context.pool.query<ReportRow>(`SELECT r.*,
      CASE
        WHEN r.target_type IN ('POST','SNAP') THEN (SELECT concat(p.title,' — ',left(p.content,500)) FROM community_posts p WHERE p.id=r.target_id)
        WHEN r.target_type='COMMENT' THEN (SELECT left(c.content,500) FROM community_comments c WHERE c.id=r.target_id)
        WHEN r.target_type='USER' THEN (SELECT u.nickname FROM users u WHERE u.id=r.target_id)
        WHEN r.target_type='EXCHANGE_LISTING' THEN (SELECT concat(x.title,' — ',left(x.details,500)) FROM exchange_listings x WHERE x.id=r.target_id)
      END AS target_preview,
      CASE
        WHEN r.target_type IN ('POST','SNAP') THEN (SELECT p.status FROM community_posts p WHERE p.id=r.target_id)
        WHEN r.target_type='COMMENT' THEN (SELECT c.status FROM community_comments c WHERE c.id=r.target_id)
        WHEN r.target_type='USER' THEN (SELECT u.status FROM users u WHERE u.id=r.target_id)
        WHEN r.target_type='EXCHANGE_LISTING' THEN (SELECT x.status FROM exchange_listings x WHERE x.id=r.target_id)
      END AS target_status
    FROM content_reports r ${filters.length?`WHERE ${filters.join(" AND ")}`:""} ORDER BY r.created_at DESC,r.id DESC LIMIT $1`,values);return cursorPage(result.rows,limit,mapReport);});

  app.post("/v1/admin/reports/:reportId/review",{preHandler:context.auth.requirePermission("reports.resolve")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).reportId,"reportId");const body=objectInput(request.body);const reason=stringInput(body,"reason",{max:1000})!;const mutation=await adminIdempotentMutation(context,request,{target:{type:"REPORT",id},bodyReason:reason,work:async(client)=>{const before=await client.query<ReportRow>("SELECT * FROM content_reports WHERE id=$1 FOR UPDATE",[id]);if(!before.rowCount)throw notFound();if(before.rows[0]!.status!=="PENDING")throw conflict("대기 중인 신고만 검토를 시작할 수 있습니다.");const updated=await client.query<ReportRow>("UPDATE content_reports SET status='REVIEWING' WHERE id=$1 RETURNING *",[id]);await writeAdminAudit(client,request,request.actor!,{action:"REPORT_REVIEW_STARTED",targetType:"REPORT",targetId:id,reason,before:before.rows[0],after:updated.rows[0]});return{statusCode:200,body:mapReport(updated.rows[0]!),resourceType:"REPORT",resourceId:id};}});return sendAdminMutation(reply,mutation);});

  app.post("/v1/admin/reports/:reportId/resolution",{preHandler:context.auth.requirePermission("reports.resolve")},async(request,reply)=>{const id=uuidInput((request.params as Record<string,unknown>).reportId,"reportId");const body=objectInput(request.body);const status=enumInput(body,"status",["RESOLVED","REJECTED"] as const)!;const action=enumInput(body,"action",["NO_ACTION","HIDE_POST","HIDE_COMMENT","WARN_USER","SUSPEND_USER"] as const)!;const reason=stringInput(body,"reason",{max:1000})!;const suspendUntil=nullableStringInput(body,"suspendUntil",{max:40});
    if(status==="REJECTED"&&action!=="NO_ACTION")throw badRequest("반려된 신고에는 징계 조치를 적용할 수 없습니다.");if(action!=="SUSPEND_USER"&&suspendUntil)throw badRequest("정지 종료일은 이용정지 조치에서만 설정할 수 있습니다.");
    const mutation=await adminIdempotentMutation(context,request,{target:{type:"REPORT",id},bodyReason:reason,work:async(client)=>{const before=await client.query<ReportRow>("SELECT * FROM content_reports WHERE id=$1 FOR UPDATE",[id]);if(!before.rowCount)throw notFound();const report=before.rows[0]!;if(!canTransitionReport(report.status,status))throw conflict("이미 처리된 신고입니다.");
      if(action==="HIDE_POST"){if(!["POST","SNAP"].includes(report.target_type))throw badRequest("신고 대상과 처리 동작이 맞지 않습니다.");const applied=await client.query("UPDATE community_posts SET status='HIDDEN',hidden_reason=$2,version=version+1 WHERE id=$1 AND status<>'DELETED' RETURNING id",[report.target_id,reason]);if(!applied.rowCount)throw notFound("신고 대상 게시물을 찾을 수 없습니다.");}
      if(action==="HIDE_COMMENT"){if(report.target_type!=="COMMENT")throw badRequest("신고 대상과 처리 동작이 맞지 않습니다.");const applied=await client.query("UPDATE community_comments SET status='HIDDEN',hidden_reason=$2 WHERE id=$1 AND status<>'DELETED' RETURNING id",[report.target_id,reason]);if(!applied.rowCount)throw notFound("신고 대상 댓글을 찾을 수 없습니다.");}
      if(action==="SUSPEND_USER"){const subjectUserId=await reportSubjectUserId(client,report);const until=suspendUntil?new Date(suspendUntil):null;if(until&&Number.isNaN(until.getTime()))throw badRequest("정지 종료일을 확인해 주세요.");if(until&&until<=new Date())throw badRequest("정지 종료일은 현재보다 이후여야 합니다.");const target=await client.query<{id:string;status:string;role:string}>("SELECT id,status,role FROM users WHERE id=$1 FOR UPDATE",[subjectUserId]);if(!target.rowCount||target.rows[0]!.role!=="USER")throw notFound("신고 대상 사용자를 찾을 수 없습니다.");if(["BANNED","DELETED"].includes(target.rows[0]!.status))throw conflict("차단·탈퇴 계정은 신고 처리에서 이용정지로 변경할 수 없습니다.");await client.query("UPDATE users SET status='SUSPENDED',suspended_until=$2,suspension_reason=$3 WHERE id=$1",[subjectUserId,until,reason]);await client.query("UPDATE user_suspensions SET revoked_at=now(),revoked_by=$2 WHERE user_id=$1 AND revoked_at IS NULL",[subjectUserId,request.actor!.userId]);await client.query("INSERT INTO user_suspensions(user_id,created_by,reason,ends_at) VALUES($1,$2,$3,$4)",[subjectUserId,request.actor!.userId,reason,until]);await client.query("UPDATE sessions SET revoked_at=now(),revoke_reason='ADMIN_REPORT_SUSPENSION' WHERE user_id=$1 AND revoked_at IS NULL",[subjectUserId]);}
      if(action==="WARN_USER"){const subjectUserId=await reportSubjectUserId(client,report);const target=await client.query("SELECT id FROM users WHERE id=$1 AND role='USER' AND status<>'DELETED'",[subjectUserId]);if(!target.rowCount)throw notFound("신고 대상 사용자를 찾을 수 없습니다.");await writeOutbox(client,request.id,{aggregateType:"USER",aggregateId:subjectUserId,eventType:"user.warning_requested",payload:{userId:subjectUserId,reportId:id,reason}});}
      await client.query("INSERT INTO moderation_actions(admin_id,report_id,action,target_type,target_id,reason) VALUES($1,$2,$3,$4,$5,$6)",[request.actor!.userId,id,action,report.target_type,report.target_id,reason]);const updated=await client.query<ReportRow>("UPDATE content_reports SET status=$2,resolution=$3,resolved_by=$4,resolved_at=now() WHERE id=$1 RETURNING *",[id,status,reason,request.actor!.userId]);await writeAdminAudit(client,request,request.actor!,{action:"REPORT_RESOLVED",targetType:"REPORT",targetId:id,reason,before:report,after:updated.rows[0],metadata:{moderationAction:action}});return{statusCode:200,body:mapReport(updated.rows[0]!),resourceType:"REPORT",resourceId:id};}});return sendAdminMutation(reply,mutation);});
}
