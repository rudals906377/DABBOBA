import { cancellationRefundNotices, deliveryPeriodNotice, postShippingNotices } from "@/features/checkout/checkout-reference-notices";

export type ProfilePolicyId = "terms" | "privacy" | "shipping-storage" | "purchase-cancellation" | "exchange-request";

export type ProfilePolicySection = {
  heading: string;
  paragraphs: string[];
};

export type ProfilePolicy = {
  id: ProfilePolicyId;
  title: string;
  summary: string;
  updatedAt: string;
  sections: ProfilePolicySection[];
};

export const PROFILE_POLICIES: readonly ProfilePolicy[] = [
  {
    id: "terms",
    title: "서비스 이용약관",
    summary: "회원, 상품 직접 선택 구매, 보관·배송과 이용 기준",
    updatedAt: "2026.10.13",
    sections: [
      {
        heading: "서비스 이용",
        paragraphs: [
          "회원은 카카오, 네이버, Google 계정으로 가입·로그인할 수 있고, iPhone에서는 Apple 계정도 사용할 수 있습니다. 휴대폰 문자 인증과 이메일 인증번호 로그인은 제공하지 않습니다.",
          "고객이 구매할 정확한 상품과 수량을 결제 전에 선택합니다. 주문·결제·보관 상품과 포인트는 회사 서버의 기록을 기준으로 확정됩니다.",
          "만 14세 미만은 회원으로 가입할 수 없습니다.",
        ],
      },
      {
        heading: "구매·결제와 환불",
        paragraphs: [
          "상품 사진·이름·종류·단가와 재고를 확인하고 원하는 상품과 수량을 선택한 뒤 결제합니다. 선택한 상품을 그대로 구매하며 결제 후 종류를 추첨하지 않습니다.",
          "취소·환불은 고객센터 1:1 문의로 주문번호와 사유를 알려 요청합니다. 결제 및 출고 상태와 주문 기록을 확인해 원래 카드 결제 취소와 사용 포인트 반환으로 처리합니다.",
          "법령상 청약철회가 가능한 경우 법정 기산일부터 7일 이내에 요청할 수 있습니다. 상품 상태와 법정 제한 사유를 확인해 안내합니다.",
        ],
      },
      {
        heading: "보관·배송·교환",
        paragraphs: [
          "구매 상품의 기본 보관기간은 결제 확인일부터 60일입니다. 쿠지 없는 배송 신청은 합계 24,900원 이상 무료배송이며 미달 시 배송비 3,000원이 부과됩니다.",
          "보관 만료 시 상품을 자동 폐기하거나 포인트로 전환하지 않습니다. 보관함의 만료일을 확인하고 기간 안에 배송을 신청해 주세요. 만료 시 고객지원에서 확인합니다.",
          "직접 구매해 현재 보관 중인 적격 상품은 교환방에서 교환할 수 있습니다. 교환 중에는 배송과 다른 교환에 사용할 수 없습니다.",
        ],
      },
      {
        heading: "이용 제한과 탈퇴",
        paragraphs: [
          "타인의 계정 사용, 결제 부정 이용, 자동화된 구매, 허위 교환, 외부 거래 유도, 타인에게 피해를 주는 콘텐츠는 제한될 수 있습니다.",
          "탈퇴는 앱의 내정보 → 설정에서 요청합니다. 진행 중인 주문·배송·교환과 보관 상품은 먼저 정리해야 하며, 남은 포인트는 동의 후 소멸합니다.",
        ],
      },
    ],
  },
  {
    id: "privacy",
    title: "개인정보처리방침",
    summary: "개인정보의 수집·이용, 보관과 회원 권리 안내",
    updatedAt: "2026.10.13",
    sections: [
      {
        heading: "처리하는 정보",
        paragraphs: [
          "로그인을 위해 소셜 로그인 제공자의 고유 식별값과 동의한 경우 인증된 이메일, 닉네임, 세션 기록을 처리하며 주문·배송을 위해 수령인, 연락처, 주소 및 거래 기록을 처리합니다.",
          "전체 카드번호, CVC, 카드 비밀번호는 주문에 표시된 결제대행사 화면에서 입력하며 회사 서버에 저장하지 않습니다. 주민등록번호·CI·DI는 수집하지 않습니다.",
        ],
      },
      {
        heading: "이용 목적과 보관",
        paragraphs: [
          "정보는 회원 확인, 주문·배송·환급·교환 처리, 고객 문의, 부정 이용 방지와 법적 의무 이행에 사용됩니다.",
          "로그인 세션 기록은 만료 후 3개월, 거래 기록은 5년, 분쟁 처리 기록은 3년 보관하며, 회원탈퇴 후에도 법령상 보관 기록은 계정과 분리해 정해진 기간 동안 보관합니다.",
        ],
      },
      {
        heading: "처리 위탁과 국외 이전",
        paragraphs: [
          "인증·데이터베이스·파일 저장은 Supabase(데이터 저장 위치 대한민국 서울), 결제는 포트원과 KG이니시스, 웹사이트와 고객지원 메일 전달은 Cloudflare, 메일 수신은 네이버 메일, 푸시 알림은 Expo, 배송은 택배사에 위탁합니다.",
        ],
      },
      {
        heading: "회원의 권리",
        paragraphs: [
          "회원은 내정보에서 개인정보와 알림·마케팅 동의를 확인·변경할 수 있으며, 고객센터를 통해 열람·정정·삭제와 처리 정지를 요청할 수 있습니다.",
        ],
      },
    ],
  },
  {
    id: "shipping-storage",
    title: "배송·보관함 정책",
    summary: "배송기간, 보관 상품의 선택, 무료배송과 출고 기준",
    updatedAt: "2026.10.13",
    sections: [
      {
        heading: "신청 가능한 상품",
        paragraphs: [
          "직접 선택해 구매한 상품은 결제가 확인된 뒤 보관함에서 배송을 신청할 수 있습니다.",
          "교환·배송이 진행 중이거나 이미 배송된 상품은 신청 목록에 표시되지 않습니다.",
          "직접 구매 상품의 기본 보관 기간은 결제 확인일부터 60일입니다. 만료 시 임의로 포인트 환급하거나 폐기하지 않고 고객지원에서 확인합니다. 이전 주문은 당시 기록된 정책으로 처리합니다.",
        ],
      },
      {
        heading: "무료배송 기준",
        paragraphs: [
          "가챠 상품만 묶어 신청할 때는 상품 합계 24,900원 이상이면 무료배송이 적용됩니다.",
          "쿠지 상품이 하나라도 포함되면 상품 합계 54,900원 이상일 때 무료배송이 적용됩니다.",
          "무료배송 기준 미달 시 배송비 3,000원이 부과됩니다.",
          "무료배송 기준에 미달하면 배송비 3,000원을 결제한 뒤 배송 신청이 접수됩니다.",
        ],
      },
      {
        heading: "배송기간과 신청 취소",
        paragraphs: [
          deliveryPeriodNotice,
          "대표가 출고와 문의·오배송·파손·환불 요청을 담당합니다. 고객센터 운영시간은 월~금 09:00~17:00이며 주말·공휴일은 쉽니다.",
          "출고가 시작되면 배송 상세에서 택배사와 송장번호를 확인할 수 있습니다. 배송 신청 취소는 고객센터에서 출고 여부를 확인한 뒤 안내합니다.",
          "배송을 신청했거나 수령한 상품은 회원 간 교환방 대상에서 제외됩니다. 하자·파손·오배송과 법령상 청약철회·교환·환불은 별도로 처리합니다.",
        ],
      },
    ],
  },
  {
    id: "purchase-cancellation",
    title: "취소·교환·환불 정책",
    summary: "주문 취소, 현금 환불과 배송 상품의 하자·오배송 처리",
    updatedAt: "2026.10.13",
    sections: [
      { heading: "주문 취소와 환불", paragraphs: cancellationRefundNotices.map(({ text }) => text) },
      { heading: "배송 후 교환과 반품", paragraphs: postShippingNotices.map(({ text }) => text) },
    ],
  },
  {
    id: "exchange-request",
    title: "교환방·신청방 운영정책",
    summary: "교환방·신청방의 작성, 신고, 차단 기준",
    updatedAt: "2026.10.13",
    sections: [
      {
        heading: "교환 제안",
        paragraphs: [
          "교환 등록과 제안에는 본인이 직접 구매해 현재 보관 중인 적격 상품을 각각 한두 개까지 사용할 수 있습니다. 교환으로 받거나 배송을 신청한 상품과 쿠지·피규어·카드 상품은 제외됩니다.",
          "배송·다른 교환에 사용 중이거나 이미 배송된 상품은 교환에 사용할 수 없습니다.",
        ],
      },
      {
        heading: "신청방",
        paragraphs: [
          "신청방에서는 카테고리와 작품, 찾는 상품과 상세 내용을 등록할 수 있습니다. 다른 회원은 ‘같이 원해요’로 관심을 표시할 수 있습니다.",
        ],
      },
      {
        heading: "금지 행위",
        paragraphs: [
          "허위 상품 등록, 외부 결제·송금 유도, 개인정보 공유, 반복 도배, 타인을 모욕하거나 권리를 침해하는 콘텐츠는 숨김 또는 이용 제한 대상이 될 수 있습니다.",
        ],
      },
      {
        heading: "신고와 차단",
        paragraphs: [
          "상세 화면에서 콘텐츠를 신고하거나 작성자를 차단할 수 있습니다. 차단한 사용자의 공개 콘텐츠는 즉시 숨겨지며, 운영팀은 신고 내용을 확인해 필요한 조치를 진행합니다.",
        ],
      },
    ],
  },
] as const;

export function findProfilePolicy(policyId: string): ProfilePolicy | null {
  return PROFILE_POLICIES.find((policy) => policy.id === policyId) ?? null;
}
