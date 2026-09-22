# DABBOBA 결제 연결 전 Cloud Run 준비 점검

이 문서는 새 유료 워크로드를 만들지 않고 할 수 있는 로컬 검증과 프로젝트 상태 조회를 정리한다. 대상은 **`dabboba-app-20260906` 하나**다. 운영 배포 절차는 [기존 Cloud Run 배포 문서](cloud-run-deployment.md)를 따른다.

Google의 [Cloud Run 환경 준비 문서](https://docs.cloud.google.com/run/docs/setup)는 프로젝트 결제 활성화와 Cloud Run Admin API 활성화를 요구한다. 따라서 프로젝트가 `ACTIVE`여도 결제가 꺼져 있으면 배포 준비가 끝난 상태가 아니다. Cloud Run 무료 사용량은 결제 계정 단위로 집계되고 한도를 넘는 사용량에는 요금이 적용되므로, 무료 구간이 있다는 사실만으로 배포 비용이 0원이라고 보장할 수 없다. [Cloud Run 요금 안내](https://cloud.google.com/run/pricing)

## 1. 로컬에서 점검 코드 검증

저장소 루트에서 실행한다. Bash와 `jq`가 필요하며, 테스트는 실제 `gcloud` 대신 명령 대역을 사용한다.

```sh
bash -n ops/cloud-run/project-readiness.sh ops/cloud-run/test-project-readiness.sh
bash ops/cloud-run/test-project-readiness.sh
```

테스트는 프로젝트 경계, 명시적 대상 인수, 결제 미연결/연결/비활성 상태, 권한·인증·네트워크 실패, 응답 형식 오류, 출력 정보 제한, 변경 명령 차단을 검사한다. 잘못된 프로젝트나 추가 변경 인수는 원격 명령을 실행하기 전에 거부한다. 전역 기본 프로젝트가 다른 제품으로 설정되어 있거나 변경 승인 환경 변수가 남아 있어도 조회 대상과 읽기 전용 동작은 바뀌지 않는다.

## 2. DABBOBA 프로젝트와 결제 상태 조회

설치된 `gcloud`의 기존 인증으로 대상 프로젝트 정보를 읽을 수 있어야 한다. 인증 정보나 계정 목록을 출력할 필요는 없다.

```sh
bash ops/cloud-run/project-readiness.sh --project dabboba-app-20260906
```

이 명령은 다음 두 조회만 수행하며 모든 호출에 정확한 `--project`를 지정한다. 프로젝트 조회 실패, 응답 불일치 또는 비활성 상태이면 결제 조회에 진입하지 않는다.

| 조회 | 확인하는 내용 | 출력 범위 |
| --- | --- | --- |
| `gcloud projects describe` | 응답 프로젝트 ID 일치, 프로젝트 생명주기 | 고정된 프로젝트 ID, 존재 확인 여부, 상태 |
| `gcloud billing projects describe` | 응답 프로젝트 ID 일치, 결제 활성화·계정 연결 여부 | 활성화와 연결 여부를 각각 `true`/`false`로 표시 |

`gcloud config set`, API 활성화, 결제 연결, 서비스 계정/IAM 생성·수정, 시크릿 접근, Cloud Build, 이미지 업로드, Cloud Run 배포·실행, 스케줄 생성은 수행하지 않는다. `.env`와 배포용 공통 스크립트도 읽지 않는다. 계정 이메일, 결제 계정 번호, 원본 CLI 오류, 시크릿 값은 결과에 포함하지 않는다. CLI 오류는 고정된 오류 코드로만 변환한다.

출력은 JSON이다. 종료 코드 `0`은 **이 범위의 진단을 완료했다는 뜻**이며 배포 허가나 배포 성공을 뜻하지 않는다.

| 종료 코드 / 주요 필드 | 의미 |
| --- | --- |
| `0`, `deployment_status: "blocked"`, `BILLING_DISABLED` | 프로젝트는 확인했지만 결제가 비활성이라 배포가 차단됨 |
| `0`, `deployment_status: "blocked"`, `PROJECT_NOT_ACTIVE` | 프로젝트가 존재하지만 활성 상태가 아님. 결제는 조회하지 않음 |
| `0`, `deployment_status: "unverified"`, `FULL_PREFLIGHT_REQUIRED` | 프로젝트와 활성 결제는 확인했지만 실제 배포 전제 조건은 미검증 |
| `1`, `read_status: "failed"` | 필수 로컬 명령 없음, 원격 조회 실패 또는 응답 검증 실패. 결과의 `error_stage`와 `error` 확인 |
| `64` | 대상 프로젝트 누락·불일치 또는 허용하지 않은 추가 인수 |

권한·인증·네트워크 오류에서 확인하지 못한 값은 `null`로 남는다. `NOT_FOUND_OR_INACCESSIBLE`은 프로젝트가 없다고 확정한 결과가 아니다. Google의 [프로젝트 조회](https://docs.cloud.google.com/sdk/gcloud/reference/projects/describe)와 [프로젝트 결제 조회](https://docs.cloud.google.com/sdk/gcloud/reference/billing/projects/describe) 문서도 대상 부재와 조회 권한 부족을 실패 원인으로 설명한다.

### 2026-09-06 실제 조회 결과

```json
{
  "schema_version": 1,
  "project_id": "dabboba-app-20260906",
  "read_status": "complete",
  "project_present": true,
  "lifecycle_state": "ACTIVE",
  "billing_enabled": false,
  "billing_linked": false,
  "deployment_status": "blocked",
  "deployment_reason": "BILLING_DISABLED",
  "full_preflight_required": true,
  "error": null,
  "error_stage": null
}
```

프로젝트 생성은 확인됐고, 현재 차단 지점은 결제 계정 미연결이다. 이 결과는 해당 날짜의 조회 기록이며 API, 서비스 계정, 시크릿, 운영 DB, 컨테이너, 배포 상태를 확인한 기록은 아니다. 나중에 재확인할 때는 같은 명령을 다시 실행한다.

## 실제 배포로 넘어가는 경계

기존 `preflight.sh base`를 포함한 운영 사전 점검은 변경하지 않는다. 그 점검에는 승인된 결제 계정과 정확한 실행 계정·권한·시크릿 참조 및 릴리스 증거가 필요하다. 이 준비 점검의 성공을 운영 사전 점검이나 릴리스 증거로 대체할 수 없다.

결제 연결, 필요한 API/리소스 생성, 빌드·배포 및 트래픽 전환은 [운영 배포 절차](cloud-run-deployment.md)에 따라 별도 승인된 단계에서 진행한다. 결제 연결 전 준비에서는 로컬 파일과 테스트를 완료하고, 실제 배포·스케줄 실행·유료 백업/PITR 활성화는 미완료 상태로 명시한다. 로컬 백업이나 복원 연습 역시 관리형 자동 백업이나 운영 복원 성공을 증명하지 않는다.

공식 문서 확인일: 2026-09-06. 요금·제공 조건은 실제 배포 전에 다시 확인한다.

단계별 증거와 남은 항목은 [무료 단계 진행표](backend-release-readiness-2026-09-06.md), 유휴·베타·Worker의 별도 비용은 [비용 추정](cloud-run-cost-estimate-2026-09-06.md)을 함께 확인한다. 현재 1분 Worker Job 주기는 무료 한도 내 운영으로 간주하지 않는다.
