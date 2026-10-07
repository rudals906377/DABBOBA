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
    summary: "회원, 상품 구매, 뽑기, 포인트와 교환·신청 이용 기준",
    updatedAt: "2026.10.07",
    sections: [
      {
        heading: "서비스 이용",
        paragraphs: [
          "회원은 카카오, 네이버, Google 계정으로 가입·로그인할 수 있고, iPhone에서는 Apple 계정도 사용할 수 있습니다. 휴대폰 문자 인증과 이메일 인증번호 로그인은 제공하지 않습니다.",
          "첫 판매 버전은 가챠 상품만 판매합니다. 주문, 결제, 뽑기 결과, 보관 상품과 포인트는 회사 서버에 기록된 내용을 기준으로 확정됩니다.",
          "만 14세 미만은 회원으로 가입할 수 없습니다.",
        ],
      },
      {
        heading: "구매·결제와 환불",
        paragraphs: [
          "결제 전에 상품 구성, 가격, 남은 수량과 종류별 제공 확률을 표시합니다. 결과는 서버가 공개된 확률표에 따라 정하며 앱은 확정된 결과만 보여 줍니다.",
          "뽑기권을 하나도 사용하지 않은 주문은 전액 취소하고, 일부 사용한 주문은 사용하지 않은 뽑기만 환불합니다. 취소·환불은 고객센터 1:1 문의로 요청합니다.",
          "결제한 날부터 7일 이내에 청약을 철회할 수 있습니다. 다만 결과가 확정된 뽑기와 회원 책임으로 훼손된 상품 등 법령상 제한 사유가 있으면 철회가 제한됩니다.",
        ],
      },
      {
        heading: "포인트와 보관 상품",
        paragraphs: [
          "획득 상품의 기본 보관기간은 획득일로부터 60일입니다. 가챠 상품만 담으면 24,900원 이상, 쿠지 상품이 포함되면 54,900원 이상일 때 무료배송이며 미달 시 배송비 3,000원이 부과됩니다.",
          "포인트 환급은 본인이 가챠에서 직접 뽑아 현재 보관 중인 상품만 가능하며, 상품별 서버 기준금액의 50%를 포인트로 돌려드립니다. 쿠지 추첨 상품, 일반 구매 상품, 교환으로 받은 상품과 이미 배송을 신청한 상품은 대상이 아닙니다.",
          "교환 등록과 제안은 본인이 가챠에서 직접 뽑아 현재 보관 중인 상품만 가능합니다. 포인트는 앱 안의 결제에만 쓰는 적립금이며 현금으로 바꿀 수 없습니다.",
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
    updatedAt: "2026.10.07",
    sections: [
      {
        heading: "처리하는 정보",
        paragraphs: [
          "로그인을 위해 소셜 로그인 제공자의 고유 식별값과 동의한 경우 인증된 이메일, 닉네임, 세션 기록을 처리하며 주문·배송을 위해 수령인, 연락처, 주소 및 거래 기록을 처리합니다.",
          "전체 카드번호, CVC, 카드 비밀번호는 KG이니시스 결제창에서 입력하며 회사 서버에 저장하지 않습니다. 주민등록번호·CI·DI는 수집하지 않습니다.",
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
    updatedAt: "2026.10.02",
    sections: [
      {
        heading: "신청 가능한 상품",
        paragraphs: [
          "가챠·쿠지에서 직접 뽑아 현재 보관함에 보관 중인 상품은 배송을 신청할 수 있습니다.",
          "교환으로 받은 상품은 포인트 환급 대상이 아니며, 포인트 환급은 본인이 가챠에서 직접 뽑아 현재 보관 중인 상품만 가능합니다. 쿠지 추첨 상품과 피규어 등 일반 구매 상품도 대상이 아닙니다.",
          "교환·환급·배송이 진행 중이거나 이미 배송된 상품은 신청 목록에 표시되지 않습니다.",
          "획득 상품의 기본 보관 기간은 획득일 기준 60일이며, 기간이 지난 상품은 배송·교환·포인트 환급을 신청할 수 없습니다.",
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
          "출고가 시작되면 배송 상세에서 택배사와 송장번호를 확인할 수 있습니다. 배송 신청 취소는 고객센터에서 출고 여부를 확인한 뒤 안내합니다.",
          "배송을 신청했거나 수령한 상품은 회원 간 교환방과 선택형 포인트 환급 대상에서 제외됩니다. 하자·파손·오배송과 법령상 청약철회·교환·환불은 별도로 처리합니다.",
        ],
      },
    ],
  },
  {
    id: "purchase-cancellation",
    title: "취소·교환·환불 정책",
    summary: "주문 취소, 현금 환불과 배송 상품의 하자·오배송 처리",
    updatedAt: "2026.10.02",
    sections: [
      { heading: "주문 취소와 환불", paragraphs: cancellationRefundNotices.map(({ text }) => text) },
      { heading: "배송 후 교환과 반품", paragraphs: postShippingNotices.map(({ text }) => text) },
    ],
  },
  {
    id: "exchange-request",
    title: "교환방·신청방 운영정책",
    summary: "교환방·신청방의 작성, 신고, 차단 기준",
    updatedAt: "2026.09.22",
    sections: [
      {
        heading: "교환 제안",
        paragraphs: [
          "교환 등록과 제안에는 본인이 가챠에서 직접 뽑아 현재 보관 중인 상품만 각각 한두 개까지 사용할 수 있습니다. 쿠지 추첨 상품과 피규어 등 일반 구매 상품은 교환할 수 없습니다.",
          "배송·환급·다른 교환에 사용 중이거나 이미 배송된 상품은 교환에 사용할 수 없습니다.",
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
