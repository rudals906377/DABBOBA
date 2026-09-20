# KG이니시스 카드사 심사 준비

## 결론

- 앱스토어 공개 등록 전에도 앱 서비스 PG 계약과 카드사 심사를 진행할 수 있다.
- 포트원의 공식 구축요건은 PG 담당자에게 APK와 앱 내 결제 경로 캡처를 PPT로 전달하는 방식을 명시한다.
- 카드사 심사 전에는 KG이니시스 테스트 채널로 결제창 호출까지 구현할 수 있다. 심사는 결제창과 카드사 목록을 확인하며 결제 이후 앱 로직의 성공까지 요구하지 않는다.
- 공식 문서는 TestFlight 또는 Google Play 비공개 테스트 링크 자체를 제출 형식으로 명시하지 않는다. 링크 제출이 필요하면 계약 담당자에게 서면 확인을 받고, 기본 제출물은 APK와 아래 캡처 PPT로 준비한다.

공식 근거:

- https://help.portone.io/content/requirements
- https://help.portone.io/category/procedure/pg-application/screening
- https://help.portone.io/content/inicis-contract
- https://help.portone.io/content/inicis

## 심사용 빌드 조건

1. PortOne 관리자에서 KG이니시스 테스트 채널을 만든다.
2. `apps/mobile`의 EAS `pg-review` 프로필로 내부 배포 빌드를 만들고, 보호된 빌드 환경에 테스트 채널의 Store ID와 Channel Key를 넣는다. 일반 `preview`는 결제가 꺼진 QA용이라 심사 캡처에 사용하지 않는다.
3. 서버는 `PAYMENT_PROVIDER=PORTONE_V2_INICIS`, 완전한 PortOne 서버 자격증명, `PORTONE_CHANNEL_ENVIRONMENT=TEST`를 사용한다.
4. 심사용 STAGING 서버와 빌드만 `DABBOBA_COMMERCE_MODE=LIVE`, `EXPO_PUBLIC_COMMERCE_CAPABILITY=LIVE`로 맞춘다.
5. 공개 production은 실 MID·LIVE 채널 검증 전 배포하지 않는다.

## PPT 캡처 순서

1. 홈 및 실제 판매 상품
2. 상품 상세: 판매가, 남은 수량, 경품과 확률 또는 쿠지 잔여 티켓
3. 주문 확인: 수량, 포인트, 최종 결제금액
4. 결제·환불 안내와 필수 동의
5. KG이니시스 결제창
6. 결제창 내 전체 카드사 목록
7. 앱 복귀 화면과 서버 결제 재조회 상태
8. 사업자정보, 이용약관, 개인정보처리방침, 고객지원

## 담당자 확인 문구

> 앱스토어 공개 등록 전인 DABBOBA 앱입니다. KG이니시스 테스트 채널이 연결된 APK와 앱 내 결제 경로 캡처 PPT를 제출하려 합니다. TestFlight 또는 Google Play 비공개 테스트 링크도 보조 접근 수단으로 인정되는지, iOS는 APK 대신 TestFlight 링크와 동일 캡처 PPT로 제출해도 되는지 서면 확인 부탁드립니다.
