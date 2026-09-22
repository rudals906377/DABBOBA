# DABBOBA Cloud Run 비용 추정 — 2026-09-06

유료 활성화는 출시 전까지 보류한다. 이 문서는 공식 요금과 현재 로컬 배포 설정을 계산한 자료이며, 결제 연결·배포·작업 실행·스케줄 생성이나 실제 청구 내역 확인을 수행한 결과가 아니다. 금액은 USD 정가 기준이고 세금, 환율, 약정 할인, 신규 가입 크레딧은 제외한다.

## 미배포·유휴 상태

Cloud Run 서비스와 Job 실행, Scheduler, 저장된 이미지·비밀·로그·빌드 산출물 등 과금 대상이 모두 없으면 이 구성의 사용료는 0이다. 프로젝트만 존재한다는 사실은 배포 완료나 무료 운영을 의미하지 않는다. 기존 유료 리소스가 있다면 별도 확인해야 한다. 결제 활성화는 Cloud Run 배포의 선행 조건이다. [환경 준비](https://docs.cloud.google.com/run/docs/setup)

현재 API 설정은 서울 `asia-northeast3`, 1 vCPU, 512MiB(0.5GiB), 요청 기반 과금, CPU boost 없음, 자동 확장, 서비스·리비전 최소 0, 서비스 최대 2다. 배포된 API도 실제로 0개 인스턴스까지 축소되면 CPU/RAM 비용은 0이지만 시작·종료·요청·프로브의 과금 시간과 저장 리소스 비용은 남을 수 있다. 최대 2는 일시적 초과가 가능한 확장 설정이지 비용 상한이 아니다. [배포 설정](../ops/cloud-run/deploy.sh), [Cloud Run 과금 시간](https://cloud.google.com/run/pricing#billable-time), [최대 인스턴스](https://docs.cloud.google.com/run/docs/configuring/max-instances)

## API만 운영할 때

서울은 Tier 2다. 요청 기반 정가는 CPU **$0.0000336/vCPU초**, RAM **$0.0000035/GiB초**, 요청 **$0.40/백만 건**이다. 요금 페이지의 기본 표는 Iowa이므로 지역 선택을 Seoul로 바꿔 확인해야 한다. [Cloud Run 요금](https://cloud.google.com/run/pricing)

`S`를 모든 API 인스턴스의 과금 시간을 합한 초, `R`을 과금 대상 요청 수로 둔다. 시간은 100ms 단위 올림을 반영한다. 동시 요청은 한 인스턴스의 CPU/RAM을 공유하므로 `요청 수 × 응답 시간`을 그대로 과금 시간으로 쓰지 않는다. 아래 단순 예시는 요청이 겹치지 않는 경우다.

계정에 남은 무료 할인을 `F_CPU`, `F_RAM`, `F_REQ`로 두면:

```text
API 비용 = max(0, 0.0000336 × S − F_CPU)
         + max(0, 0.00000175 × S − F_RAM)
         + 0.0000004 × max(0, R − F_REQ)
```

다른 사용량이 없는 결제 계정에서 월 전체 무료 할인은 CPU `$4.32 = 180,000 × 0.000024`, RAM `$0.90 = 360,000 × 0.0000025`, 요청 `2,000,000건`에 해당한다. 무료 구간은 Tier 1 가격 기준의 지출 할인이고 결제 계정의 프로젝트들이 공유한다. 서울에서는 CPU 약 128,571 vCPU초와 RAM 약 257,143 GiB초에 해당한다. 다른 프로젝트나 Cloud Run 사용량이 있으면 남은 할인만 적용한다. [무료 구간과 과금 방식](https://cloud.google.com/run/pricing)

| 가정 | API CPU/RAM/요청 예상액 | 별도 비용 |
| --- | ---: | --- |
| 소규모 베타: 월 10만 건, 겹치지 않는 200ms 요청, `S=20,000`, 시작·프로브 등 추가 시간을 제외 | 무료 할인이 충분하면 **$0** | 한국으로 건당 10KiB 전송 시 약 0.954GiB, **$0.18** |
| 초과 사례: 월 300만 건, 측정된 `S=200,000`, 무료 할인 전체 사용 가능 | CPU $2.40 + RAM $0 + 요청 $0.40 = **$2.80** | 전송·저장·작업자 비용 추가 |
| 2개 인스턴스가 30일 내내 과금 상태, `S=5,184,000` | CPU/RAM 정가 **$183.25**, 무료 할인 전체 적용 시 **$178.03** | 요청과 부대 비용 추가; 비용 상한 아님 |

위 소규모 베타의 $0은 API 계산 결과다. 실제 시작·종료·프로브 시간은 `container/billable_instance_time`에 포함해 다시 계산한다. [과금 시간](https://cloud.google.com/run/pricing#billable-time), [한국 목적지 인터넷 전송 요금](https://cloud.google.com/vpc/network-pricing)

## 현재 1분 간격 Worker는 별도 유료 예상

현재 Worker는 1 vCPU/512MiB Job이며 1분마다 예약 실행하도록 준비되어 있다. 애플리케이션 작업 창이 45초이거나 잠금을 얻지 못해 곧바로 끝나도, 시작된 Job 인스턴스에는 **실행당 최소 60초**가 과금된다. 서울 Job 정가는 CPU `$0.0000216/vCPU초`, RAM `$0.0000024/GiB초`다. [스케줄 상수](../ops/cloud-run/_common.sh), [Job 요금과 최소 과금](https://cloud.google.com/run/pricing#billable-time)

```text
J = 각 실행·재시도의 max(60초, 100ms 단위로 올림한 인스턴스 수명)을 합한 값
Worker 비용 = max(0, 0.0000216 × J − 남은 CPU 무료 할인)
            + max(0, 0.0000012 × J − 남은 RAM 무료 할인)

30일 × 24시간 × 60회 = 43,200회
모든 실행이 60초 이하이고 재시도·수동 실행이 없을 때 J = 2,592,000초
정가 = $55.9872 + $3.1104 = $59.0976
이 작업자에 전체 월 무료 할인을 적용할 수 있을 때 = $59.0976 − $4.32 − $0.90 = $53.8776
```

따라서 현재 예약을 켜면 이용자가 거의 없어도 **Worker CPU/RAM만 월 약 $54**를 예상해야 한다. 무료 할인을 다른 사용량이 소진했다면 약 $59.10이고, 60초 초과 실행·재시도·수동 실행·부대 비용은 추가된다. API 예시와 Worker 예시는 각각 전체 무료 할인을 가정하므로 둘을 합산할 때 같은 할인을 두 번 빼지 않는다. 합산 계산은 각 자원 정가를 더한 뒤 계정의 남은 해당 할인만 한 번 적용한다. 이 문서는 예약 주기나 쿠지 만료 정책을 변경하지 않는다.

## 부대 비용과 무료 구간

| 항목 | 계산 기준과 경계 |
| --- | --- |
| 한국 목적지 인터넷 전송 | 첫 1,024GiB 구간 `$0.19 × 전송 GiB`. Cloud Run의 북미 1GiB 무료 전송은 서울→한국에 적용되지 않는다. API·DB·외부 서비스 통신도 목적지별로 확인한다. [네트워크 요금](https://cloud.google.com/vpc/network-pricing), [Cloud Run 전송 요금](https://cloud.google.com/run/pricing) |
| Secret Manager | 결제 계정당 활성 버전 6개, 접근 10,000회 무료. 초과 접근은 `$0.03 × 초과 접근 수 / 10,000`; 초과 버전은 위치별 실제 시간당 `$0.000082192`(월 약 $0.06/버전). 비활성화한 버전도 활성 버전 과금에 포함된다. Worker가 실행마다 비밀을 한 번 읽는다고 가정하면 43,200회 접근 중 초과 33,200회는 약 **$0.10**다. 실제 접근 수로 확인한다. [Secret Manager 요금](https://cloud.google.com/secret-manager/pricing) |
| Cloud Logging | 일반 로그 저장 월 50GiB/프로젝트 무료, 초과분 `$0.50 × max(0, 월 로그 GiB − 50)`. 30일 초과 보관은 추가 `$0.01/GiB·월`; 네트워크 제공 로그 등 별도 SKU는 이 식에 포함하지 않는다. 빌드 로그도 고려한다. [Logging 요금](https://cloud.google.com/products/observability/pricing) |
| Artifact Registry | 결제 계정 합계 0.5GiB·월 무료. 초과 저장은 `$0.000136986/GiB·시간`(월 약 $0.10/GiB). 서울 저장소→서울 Cloud Run 전송은 무료이며 다른 지역·외부 다운로드는 별도다. 취약점 스캔을 활성화하면 추가 과금될 수 있다. [Artifact Registry 요금](https://cloud.google.com/artifact-registry/pricing) |
| Cloud Scheduler | 결제 계정당 3개 Job 무료. 초과는 `$0.10/Job/31일`, 실제 존재 일수로 비례 과금한다. 일시중지 Job도 개수에 포함한다. 이 요금은 실행되는 Cloud Run Job 비용과 별개다. [Scheduler 요금](https://cloud.google.com/scheduler/pricing) |
| Cloud Build | 실제 빌드가 기본 풀 `e2-standard-2`일 때 결제 계정당 월 2,500분 무료, 초과 `$0.006 × max(0, 빌드 분 − 2,500)`. 초 단위 사용을 반영하고 대기 시간은 제외한다. 무료 구간은 변경 가능한 프로모션이며 다른 머신·풀에는 그대로 적용하지 않는다. 현재 YAML은 머신을 고정하지 않으므로 실행 설정 확인이 필요하다. 소스 업로드용 Cloud Storage 저장·작업·전송과 Registry/Logging 비용도 별도다. [Cloud Build 요금](https://cloud.google.com/build/pricing), [빌드 설정](../ops/cloud-run/cloudbuild.yaml) |

이 계산에는 Supabase, 외부 인증·SMS·결제 제공자, 이미지 저장·전송, 도메인·로드밸런서, 별도 모니터링 상품의 비용이 포함되지 않는다.

## 예산 알림과 실행 경계

기존 문서의 월 $5 예산에서 20%·100% 실제 지출 알림은 각각 **$1·$5 알림**이다. 일반 예산은 자동 정지나 비용 상한이 아니며 사용량 보고·알림에는 지연이 있다. 현재 Worker 예상액은 이 예산보다 크므로, 출시 시 비용과 수신자를 확인한 뒤 기존 승인 절차로 활성화해야 한다. 이 문서 작성으로 예산이나 유료 리소스를 만들지 않았다. [예산과 알림](https://docs.cloud.google.com/billing/docs/how-to/budgets), [기존 배포 안내](cloud-run-deployment.md#budget-and-expected-cost)
