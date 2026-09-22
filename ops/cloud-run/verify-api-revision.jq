# Cloud Run REST v1 Revision and v2 Revision only, not a Service/template.
# Secret payloads are never read or included in diagnostic messages.
def ensure($condition; $message):
  if $condition then true else error($message) end;
def empty_array:
  . == null or (type == "array" and length == 0);
def same_project_secret:
  if type != "string" then error("invalid API secret reference")
  elif test("^[A-Za-z0-9_-]{1,255}\\z") then .
  else
    capture("^projects/(?<project>[a-z0-9-]+)/secrets/(?<secret>[A-Za-z0-9_-]{1,255})\\z")
    // error("invalid API full secret reference")
    | if .project == $expected_project or .project == $expected_project_number then .secret
      else error("API secret reference belongs to another project") end
  end;
def expected_secret($name):
  any($expected_secret_env[]; .secret == $name);

. as $revision
| ensure(type == "object"; "API Revision must be an object")
| (if ($revision | has("spec")) then
    ensure(($revision | has("containers") or has("serviceAccount") or has("annotations")) | not;
      "ambiguous API Revision representation")
    | ensure(($revision.metadata.name == $expected_revision)
        and (($revision.metadata.namespace // $expected_project) == $expected_project
          or $revision.metadata.namespace == $expected_project_number);
        "API Revision identity does not match")
    | {spec:$revision.spec, account:$revision.spec.serviceAccountName,
       annotations:($revision.metadata.annotations // {}), style:"v1"}
  else
    ensure(($revision | has("metadata")) | not; "ambiguous API Revision representation")
    | ensure(($revision.name == "projects/\($expected_project)/locations/\($expected_region)/services/\($expected_service)/revisions/\($expected_revision)"
        or $revision.name == "projects/\($expected_project_number)/locations/\($expected_region)/services/\($expected_service)/revisions/\($expected_revision)");
        "API Revision identity does not match")
    | {spec:$revision, account:$revision.serviceAccount, annotations:($revision.annotations // {}), style:"v2"}
  end) as $normalized
| $normalized.spec as $spec
| ensure(($spec | type) == "object" and ($spec | has("template") | not); "invalid API Revision spec")
| ensure(($spec.containers | type) == "array" and ($spec.containers | length) == 1;
    "API Revision must contain exactly one container")
| $spec.containers[0] as $container
| ensure(($container | type) == "object"; "invalid API container")
| ensure($container.image == $expected_image or $container.image == $expected_digest_image;
    "API Revision image does not match the approved immutable image")
| ensure($normalized.account == $expected_service_account; "API Revision service account does not match")
| ensure(($container.command | empty_array) and ($container.args | empty_array)
    and ($container.envFrom | empty_array) and ($container.volumeMounts | empty_array)
    and ($spec.volumes | empty_array) and (($container.workingDir // "") == "")
    and ($container | has("sourceCode") | not);
    "API Revision must not override image execution or attach extra configuration")
| ($container.env // error("API Revision environment is missing")) as $env
| ensure(($env | type) == "array"; "API Revision environment must be an array")
| ensure(all($env[];
    type == "object" and (.name | type) == "string" and
    if has("value") then
      (keys | sort) == ["name", "value"] and (.value | type) == "string"
    elif $normalized.style == "v1" and has("valueFrom") then
      (keys | sort) == ["name", "valueFrom"]
      and (.valueFrom | type) == "object" and (.valueFrom | keys) == ["secretKeyRef"]
      and (.valueFrom.secretKeyRef | type) == "object"
      and ((.valueFrom.secretKeyRef | keys | sort) == ["key", "name"]
        or ((.valueFrom.secretKeyRef | keys | sort) == ["key", "name", "optional"] and .valueFrom.secretKeyRef.optional == false))
      and (.valueFrom.secretKeyRef.name | type) == "string" and (.valueFrom.secretKeyRef.key | type) == "string"
    elif $normalized.style == "v2" and has("valueSource") then
      (keys | sort) == ["name", "valueSource"]
      and (.valueSource | type) == "object" and (.valueSource | keys) == ["secretKeyRef"]
      and (.valueSource.secretKeyRef | type) == "object"
      and (.valueSource.secretKeyRef | keys | sort) == ["secret", "version"]
      and (.valueSource.secretKeyRef.secret | type) == "string" and (.valueSource.secretKeyRef.version | type) == "string"
    else false end); "API environment must use exact plain values or unambiguous Secret Manager references")
| ensure(([$env[].name] | length) == ([$env[].name] | unique | length);
    "API environment contains duplicate variable names")
| ensure(($normalized.annotations | type) == "object"; "invalid API Revision annotations")
| ($normalized.annotations["run.googleapis.com/secrets"] // "") as $alias_text
| ensure(($alias_text | type) == "string"; "invalid API secret aliases")
| ensure($normalized.style == "v1" or $alias_text == ""; "API v2 Revision must not use v1 secret aliases")
| (if $alias_text == "" then [] else $alias_text | split(",") | map(
    capture("^(?<key>[A-Za-z0-9_-]{1,255}):(?<value>projects/[a-z0-9-]+/secrets/[A-Za-z0-9_-]{1,255})\\z")
    // error("invalid API secret alias definition")) end) as $alias_entries
| ensure(($alias_entries | length) == ($alias_entries | map(.key) | unique | length);
    "duplicate API secret alias definitions")
| ensure(all($alias_entries[]; .key as $alias
    | (.value | same_project_secret) as $secret
    | expected_secret($secret) and any($env[]; .valueFrom.secretKeyRef.name == $alias));
    "API secret aliases must identify used approved same-project secrets")
| ($alias_entries | from_entries) as $aliases
| ([$env[] | select(has("value")) | {key:.name, value:.value}] | from_entries) as $actual_plain
| ([$env[] | select(has("value") | not)
    | (.valueFrom.secretKeyRef.name // .valueSource.secretKeyRef.secret) as $reference
    | {key:.name, value:{
        secret:(($aliases[$reference] // $reference) | same_project_secret),
        version:(.valueFrom.secretKeyRef.key // .valueSource.secretKeyRef.version)}}] | from_entries) as $actual_secrets
| ensure(($env | length) == (($expected_plain_env | length) + ($expected_secret_env | length));
    "API environment must contain exactly the approved variables")
| ensure($actual_plain == $expected_plain_env; "API plain environment does not match the approved configuration")
| ensure($actual_secrets == $expected_secret_env; "API secret IDs or pinned versions do not match the approved configuration")
