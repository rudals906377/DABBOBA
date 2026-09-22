def ensure($condition; $message):
  if $condition then true else error($message) end;

. as $job
| ($job.spec.template.spec // error("worker Job execution template is missing")) as $execution
| ($execution.template.spec // error("worker Job task template is missing")) as $task
| ($task.containers // []) as $containers
| ensure(($containers | length) == 1; "worker Job must contain exactly one container")
| $containers[0] as $container
| ($container.env // []) as $env
| ensure(($env | type) == "array"; "worker Job environment must be an array")
| ensure(all($env[]; type == "object" and (.name | type) == "string"); "invalid worker environment entry")
| ensure(all($env[];
    if has("value") then
      (keys | sort) == ["name", "value"] and (.value | type) == "string"
    elif has("valueFrom") then
      (keys | sort) == ["name", "valueFrom"]
      and (.valueFrom | type) == "object" and (.valueFrom | keys) == ["secretKeyRef"]
      and (.valueFrom.secretKeyRef | type) == "object"
      and (.valueFrom.secretKeyRef | keys | sort) == ["key", "name"]
      and (.valueFrom.secretKeyRef.name | type) == "string" and (.valueFrom.secretKeyRef.key | type) == "string"
    elif has("valueSource") then
      (keys | sort) == ["name", "valueSource"]
      and (.valueSource | type) == "object" and (.valueSource | keys) == ["secretKeyRef"]
      and (.valueSource.secretKeyRef | type) == "object"
      and (.valueSource.secretKeyRef | keys | sort) == ["secret", "version"]
      and (.valueSource.secretKeyRef.secret | type) == "string" and (.valueSource.secretKeyRef.version | type) == "string"
    else false end); "worker environment must contain plain values or unambiguous Secret Manager references only")
| ([$env[]
    | select(has("value"))
    | {key: .name, value: .value}]
    | from_entries) as $actual_plain_env
| ([$env[] | select(has("value") | not)
    | {key:.name, value:{
        secret:((.valueFrom.secretKeyRef.name // .valueSource.secretKeyRef.secret)
          | if startswith("projects/\($expected_project)/secrets/") then ltrimstr("projects/\($expected_project)/secrets/") else . end),
        version:(.valueFrom.secretKeyRef.key // .valueSource.secretKeyRef.version)}}]
    | from_entries) as $actual_secret_env
| (($task.timeoutSeconds // $task.timeout // "") | tostring | sub("s$"; "") | tonumber) as $timeout_seconds
| (($execution.taskCount // -1) | tonumber) as $task_count
| (($execution.parallelism // -1) | tonumber) as $parallelism
| (($task.maxRetries // 0) | tonumber) as $max_retries
| (($container.resources.limits.cpu // "") | tostring) as $cpu
| (($container.resources.limits.memory // "") | tostring) as $memory
| [
    ensure(
      (($job.metadata.generation // "missing") | tostring)
        == (($job.status.observedGeneration // "unobserved") | tostring);
      "worker Job has an unobserved generation"
    ),
    ensure(
      any($job.status.conditions[]?; .type == "Ready" and .status == "True");
      "worker Job is not Ready"
    ),
    ensure(
      ($container.image == $expected_image or $container.image == $expected_digest_image);
      "worker Job image does not match the approved immutable image"
    ),
    ensure(($container.command // [] | length) == 0; "worker Job must not override the image command"),
    ensure(($container.args // [] | length) == 0; "worker Job must not override the image arguments"),
    ensure(($container.envFrom // [] | length) == 0; "worker Job must not use envFrom"),
    ensure(($container.volumeMounts // [] | length) == 0; "worker Job must not mount extra volumes"),
    ensure(($task.volumes // [] | length) == 0; "worker Job must not define extra volumes"),
    ensure(($container.ports // [] | length) == 0; "worker Job must not expose container ports"),
    ensure(($container.workingDir // "") == ""; "worker Job must not override the image working directory"),
    ensure($task.serviceAccountName == $expected_service_account; "worker Job service account does not match"),
    ensure($task_count == 1; "worker Job taskCount must be 1"),
    ensure($parallelism == 1; "worker Job parallelism must be 1"),
    ensure($max_retries == 3; "worker Job maxRetries must be 3"),
    ensure($timeout_seconds == 600; "worker Job timeout must be 600 seconds"),
    ensure(($cpu == "1" or $cpu == "1000m"); "worker Job CPU limit must be 1 vCPU"),
    ensure($memory == "512Mi"; "worker Job memory limit must be 512Mi"),
    ensure(
      (($container.resources.limits // {} | keys | sort) == ["cpu", "memory"]);
      "worker Job must not request extra resource types"
    ),
    ensure(($env | length) == (($expected_plain_env | length) + ($expected_secret_env | length)); "worker Job environment must contain exactly the approved variables"),
    ensure(
      ([$env[].name] | length) == ([$env[].name] | unique | length);
      "worker Job environment contains duplicate variable names"
    ),
    ensure($actual_plain_env == $expected_plain_env; "worker Job plain environment does not match"),
    ensure($actual_secret_env == $expected_secret_env; "worker Job secret references or exact versions do not match")
  ]
| all
