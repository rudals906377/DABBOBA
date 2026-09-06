// PGMQ extension-owned queue relations are omitted by pg_dump. Keep their
// explicit, versioned supplement inside the same authenticated backup bundle.
const BUNDLE_MAGIC = Buffer.from('DABBOBA-SNAPSHOT-BUNDLE2\n');
export const BACKUP_BUNDLE_LIMIT = 256 * 1024 * 1024;
const MAX_INT64 = 9223372036854775807n;
const queueName = /^[a-z0-9_]{1,47}$/;
const fail = () => { throw new Error('Unsupported or invalid queue backup bundle; no restore was attempted.'); };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const int64 = (value) => {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) fail();
  const number = BigInt(value);
  if (number > MAX_INT64) fail();
  return number;
};
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const jsonSql = (value) => `convert_from(decode('${Buffer.from(value).toString('hex')}','hex'),'UTF8')::jsonb`;

export function validateQueueManifest(manifest) {
  if (!isRecord(manifest) || manifest.version !== 2 || !Array.isArray(manifest.extensions)
    || manifest.extensions.length > 100 || !Array.isArray(manifest.queues) || manifest.queues.length > 1000) fail();
  const extensions = new Set();
  for (const extension of manifest.extensions) {
    if (!isRecord(extension) || typeof extension.name !== 'string' || typeof extension.version !== 'string'
      || !/^[a-zA-Z0-9_-]{1,63}$/.test(extension.name)
      || !/^[a-zA-Z0-9_.+-]{1,80}$/.test(extension.version) || extensions.has(extension.name)) fail();
    extensions.add(extension.name);
  }
  if (manifest.queues.length && !extensions.has('pgmq')) fail();
  const names = new Set();
  for (const queue of manifest.queues) {
    if (!isRecord(queue) || typeof queue.name !== 'string' || !queueName.test(queue.name) || names.has(queue.name)
      || !timestamp(queue.createdAt) || queue.isPartitioned !== false || queue.isUnlogged !== false) fail();
    names.add(queue.name);
    let maximumId = 0n;
    for (const [field, archive] of [['live', false], ['archive', true]]) {
      const table = queue[field];
      if (!isRecord(table) || typeof table.rowsJson !== 'string' || Buffer.byteLength(table.rowsJson) > BACKUP_BUNDLE_LIMIT
        || typeof table.rls !== 'boolean' || typeof table.forceRls !== 'boolean') fail();
      let rows;
      try { rows = JSON.parse(table.rowsJson); } catch { fail(); }
      if (!Array.isArray(rows)) fail();
      const ids = new Set();
      const fields = ['msg_id', 'read_ct', 'enqueued_at', 'vt', 'message', 'headers', ...(archive ? ['archived_at'] : [])].sort();
      for (const row of rows) {
        if (!isRecord(row) || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(fields)
          || !Number.isInteger(row.read_ct) || row.read_ct < -2147483648 || row.read_ct > 2147483647
          || !timestamp(row.enqueued_at) || !timestamp(row.vt) || (archive && !timestamp(row.archived_at))) fail();
        const id = int64(row.msg_id);
        if (ids.has(row.msg_id)) fail();
        ids.add(row.msg_id);
        if (id > maximumId) maximumId = id;
      }
    }
    const sequence = queue.sequence;
    if (!isRecord(sequence) || typeof sequence.isCalled !== 'boolean' || sequence.cycle !== false) fail();
    const last = int64(sequence.lastValue);
    const increment = int64(sequence.increment);
    const start = int64(sequence.start);
    const minimum = int64(sequence.minimum);
    const maximum = int64(sequence.maximum);
    int64(sequence.cache);
    if (increment !== 1n || minimum !== 1n || start > maximum || last > maximum
      || (sequence.isCalled ? last < maximumId : last <= maximumId)) fail();
  }
  return manifest;
}

export function packBackupBundle(dump, manifest) {
  validateQueueManifest(manifest);
  if (!Buffer.isBuffer(dump) || dump.subarray(0, 5).toString() !== 'PGDMP') fail();
  const metadata = Buffer.from(JSON.stringify(manifest));
  const size = BUNDLE_MAGIC.length + 4 + metadata.length + dump.length;
  if (size > BACKUP_BUNDLE_LIMIT) throw new Error('Snapshot bundle exceeds the 256 MiB offline-tool limit.');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  return Buffer.concat([BUNDLE_MAGIC, length, metadata, dump]);
}

export function unpackBackupBundle(bundle) {
  if (!Buffer.isBuffer(bundle) || bundle.length > BACKUP_BUNDLE_LIMIT
    || !bundle.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)
    || bundle.length < BUNDLE_MAGIC.length + 9) fail();
  const metadataSize = bundle.readUInt32BE(BUNDLE_MAGIC.length);
  const metadataOffset = BUNDLE_MAGIC.length + 4;
  if (metadataSize < 2 || metadataSize > bundle.length - metadataOffset - 5) fail();
  let manifest;
  try { manifest = JSON.parse(bundle.subarray(metadataOffset, metadataOffset + metadataSize).toString('utf8')); } catch { fail(); }
  validateQueueManifest(manifest);
  const dump = bundle.subarray(metadataOffset + metadataSize);
  if (dump.subarray(0, 5).toString() !== 'PGDMP') fail();
  return { manifest, dump };
}

/** query runs in the read-only transaction that exports pg_dump's snapshot. */
export async function captureQueueManifest(query) {
  const extensions = JSON.parse(await query("SELECT COALESCE(jsonb_agg(jsonb_build_object('name',extname,'version',extversion) ORDER BY extname),'[]') FROM pg_extension;"));
  const manifest = { version: 2, extensions, queues: [] };
  let manifestBytes = Buffer.byteLength(JSON.stringify(manifest));
  if (!extensions.some((extension) => extension.name === 'pgmq')) return validateQueueManifest(manifest);
  const metadata = JSON.parse(await query("SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY queue_name),'[]') FROM pgmq.meta m;"));
  if (metadata.length > 1000) fail();
  for (const meta of metadata) {
    if (!isRecord(meta) || typeof meta.queue_name !== 'string' || !queueName.test(meta.queue_name)
      || JSON.stringify(Object.keys(meta).sort()) !== '["created_at","is_partitioned","is_unlogged","queue_name"]'
      || meta.is_partitioned !== false || meta.is_unlogged !== false) fail();
    const queue = { name: meta.queue_name, createdAt: meta.created_at, isPartitioned: false, isUnlogged: false };
    for (const [field, prefix] of [['live', 'q'], ['archive', 'a']]) {
      const table = `${prefix}_${queue.name}`;
      const shape = JSON.parse(await query(`SELECT jsonb_build_object(
        'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'kind',c.relkind,'persistence',c.relpersistence,
        'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity) ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
        'defaults',(SELECT jsonb_agg(jsonb_build_array(a.attname,pg_get_expr(d.adbin,d.adrelid,false)) ORDER BY a.attnum)
          FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=c.oid),
        'triggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal),
        'policies',(SELECT count(*) FROM pg_policy WHERE polrelid=c.oid),
        'constraints',(SELECT jsonb_agg(contype ORDER BY contype) FROM pg_constraint WHERE conrelid=c.oid),
        'indexes',(SELECT jsonb_agg(jsonb_build_array(i.indisprimary,i.indisunique,
          (SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
            JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum),i.indexprs IS NULL,i.indpred IS NULL,
          am.amname,i.indisvalid,i.indisready,i.indimmediate,i.indnullsnotdistinct,i.indoption::text,
          i.indnkeyatts,i.indnatts,idx.relname) ORDER BY i.indisprimary DESC) FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid
          JOIN pg_am am ON am.oid=idx.relam WHERE i.indrelid=c.oid))
        FROM pg_class c WHERE c.oid='pgmq.${table}'::regclass;`));
      const columns = [
        ['msg_id','bigint',true,field === 'live' ? 'a' : ''], ['read_ct','integer',true,''],
        ['enqueued_at','timestamp with time zone',true,''],
        ...(field === 'archive' ? [['archived_at','timestamp with time zone',true,'']] : []),
        ['vt','timestamp with time zone',true,''], ['message','jsonb',false,''], ['headers','jsonb',false,''],
      ];
      const defaults = [['read_ct','0'],['enqueued_at','now()'], ...(field === 'archive' ? [['archived_at','now()']] : [])];
      const indexes = [
        [true,true,['msg_id'],true,true,'btree',true,true,true,false,'0',1,1,`${table}_pkey`],
        [false,false,[field === 'live' ? 'vt' : 'archived_at'],true,true,'btree',true,true,true,false,'0',1,1,
          field === 'live' ? `${table}_vt_idx` : `archived_at_idx_${queue.name}`],
      ];
      if (shape.kind !== 'r' || shape.persistence !== 'p' || shape.triggers !== 0 || shape.policies !== 0
        || JSON.stringify(shape.columns) !== JSON.stringify(columns)
        || JSON.stringify(shape.defaults) !== JSON.stringify(defaults)
        || JSON.stringify(shape.constraints) !== '["p"]' || JSON.stringify(shape.indexes) !== JSON.stringify(indexes)) fail();
      queue[field] = {
        rls: shape.rls, forceRls: shape.forceRls,
        // Keep JSONB payloads as text, including numeric values outside JS's safe integer range.
        rowsJson: await query(`SELECT COALESCE(jsonb_agg(to_jsonb(t)||jsonb_build_object('msg_id',msg_id::text) ORDER BY msg_id),'[]') FROM pgmq.${table} t;`),
      };
    }
    queue.sequence = JSON.parse(await query(`SELECT jsonb_build_object('lastValue',v.last_value::text,'isCalled',v.is_called,
      'increment',s.seqincrement::text,'start',s.seqstart::text,'minimum',s.seqmin::text,'maximum',s.seqmax::text,
      'cache',s.seqcache::text,'cycle',s.seqcycle) FROM pgmq.q_${queue.name}_msg_id_seq v
      CROSS JOIN pg_sequence s WHERE s.seqrelid='pgmq.q_${queue.name}_msg_id_seq'::regclass;`));
    manifestBytes += Buffer.byteLength(JSON.stringify(queue)) + 1;
    if (manifestBytes > BACKUP_BUNDLE_LIMIT) throw new Error('Queue snapshot exceeds the 256 MiB offline-tool limit.');
    manifest.queues.push(queue);
  }
  // Extra queue tables not represented by pgmq.meta must not be silently omitted.
  const relations = JSON.parse(await query("SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pgmq' AND c.relkind IN ('r','p','S');"));
  const expected = ['meta', ...manifest.queues.flatMap((queue) => [`q_${queue.name}`, `a_${queue.name}`, `q_${queue.name}_msg_id_seq`])].sort();
  if (JSON.stringify(relations) !== JSON.stringify(expected)) fail();
  return validateQueueManifest(manifest);
}

export function queueRestoreSql(manifest) {
  validateQueueManifest(manifest);
  const statements = [];
  statements.push(`DO $dbb_extension_count$ BEGIN IF (SELECT count(*) FROM pg_extension) <> ${manifest.extensions.length} THEN RAISE EXCEPTION 'Restored extension set mismatch'; END IF; END $dbb_extension_count$;`);
  for (const extension of manifest.extensions) {
    statements.push(`DO $dbb_extension$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='${extension.name}' AND extversion='${extension.version}') THEN RAISE EXCEPTION 'Restored extension version mismatch'; END IF; END $dbb_extension$;`);
  }
  for (const queue of manifest.queues) {
    statements.push(`SELECT pgmq.create('${queue.name}'::text);`);
    statements.push(`UPDATE pgmq.meta SET created_at=(${jsonSql(JSON.stringify({ createdAt: queue.createdAt }))}->>'createdAt')::timestamptz WHERE queue_name='${queue.name}';`);
    for (const [field, prefix] of [['live','q'], ['archive','a']]) {
      const name = `pgmq.${prefix}_${queue.name}`;
      statements.push(`INSERT INTO ${name} ${field === 'live' ? 'OVERRIDING SYSTEM VALUE ' : ''}SELECT * FROM jsonb_populate_recordset(NULL::${name},${jsonSql(queue[field].rowsJson)});`);
      statements.push(`ALTER TABLE ${name} ${queue[field].rls ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`);
      statements.push(`ALTER TABLE ${name} ${queue[field].forceRls ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY;`);
    }
    const s = queue.sequence;
    statements.push(`ALTER SEQUENCE pgmq.q_${queue.name}_msg_id_seq INCREMENT BY ${s.increment} MINVALUE ${s.minimum} MAXVALUE ${s.maximum} START WITH ${s.start} CACHE ${s.cache} NO CYCLE;`);
    statements.push(`SELECT setval('pgmq.q_${queue.name}_msg_id_seq',${s.lastValue},${s.isCalled});`);
  }
  const sql = statements.join('\n');
  if (Buffer.byteLength(sql) > BACKUP_BUNDLE_LIMIT) throw new Error('Decoded queue SQL exceeds the 256 MiB offline-tool limit.');
  return sql;
}
