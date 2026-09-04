export type ProfilePolicyId = "terms" | "privacy" | "shipping-storage" | "exchange-request";

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
    summary: "회원, 상품 구매, 뽑기, 포인트와 커뮤니티 이용 기준",
    updatedAt: "2026.08.30",
    sections: [
      {
        heading: "서비스 이용",
        paragraphs: [
          "회원은 본인의 계정으로 상품을 구매하고 가챠·쿠지에 참여하며, 확정된 상품을 보관함에서 관리할 수 있습니다.",
          "주문과 추첨 결과는 결제 승인 및 서버에 기록된 결과를 기준으로 확정됩니다.",
        ],
      },
      {
        heading: "포인트와 보관 상품",
        paragraphs: [
          "보관 중인 상품은 각 기능의 대상 조건에 따라 배송을 신청할 수 있습니다. 포인트 환급과 교환은 가챠에서 직접 뽑아 현재 보관 중인 상품만 가능하며, 쿠지 추첨 상품과 피규어 등 일반 구매 상품은 대상이 아닙니다.",
          "이미 배송을 신청했거나 배송받은 상품은 다시 환급하거나 교환할 수 없습니다.",
          "포인트는 서비스가 정한 용도와 유효기간 안에서 사용할 수 있으며 현금과 동일하게 취급되지 않습니다.",
        ],
      },
      {
        heading: "이용 제한",
        paragraphs: [
          "타인의 계정 사용, 결제 부정 이용, 자동화된 구매, 허위 교환, 외부 거래 유도, 타인에게 피해를 주는 콘텐츠는 제한될 수 있습니다.",
        ],
      },
    ],
  },
  {
    id: "privacy",
    title: "개인정보처리방침",
    summary: "개인정보의 수집·이용, 보관과 회원 권리 안내",
    updatedAt: "2026.08.30",
    sections: [
      {
        heading: "처리하는 정보",
        paragraphs: [
          "계정 운영을 위해 이메일, 닉네임과 로그인 기록을 처리하며 주문과 배송을 위해 수령인, 연락처, 주소 및 거래 기록을 처리합니다.",
          "전체 카드번호, 보안번호와 결제 비밀번호는 앱에 저장하지 않으며 결제 제공사가 발급한 안전한 식별값만 사용합니다.",
        ],
      },
      {
        heading: "이용 목적과 보관",
        paragraphs: [
          "정보는 회원 확인, 주문·배송·환급·교환 처리, 고객 문의, 부정 이용 방지와 법적 의무 이행에 사용됩니다.",
          "회원탈퇴 후에도 관계 법령에 따라 보관해야 하는 거래 기록은 계정과 분리하여 정해진 기간 동안 보관될 수 있습니다.",
        ],
      },
      {
        heading: "회원의 권리",
        paragraphs: [
          "회원은 내정보에서 개인정보와 수신 동의를 확인·변경할 수 있으며, 고객센터를 통해 열람·정정·삭제와 처리 정지를 요청할 수 있습니다.",
        ],
      },
    ],
  },
  {
    id: "shipping-storage",
    title: "배송·보관함 정책",
    summary: "보관 상품의 선택, 무료배송과 출고 기준",
    updatedAt: "2026.08.30",
    sections: [
      {
        heading: "신청 가능한 상품",
        paragraphs: [
          "가챠·쿠지에서 직접 뽑아 현재 보관함에 보관 중인 상품은 배송을 신청할 수 있습니다.",
          "포인트 환급은 가챠에서 직접 뽑아 현재 보관 중인 상품만 가능하며, 쿠지 추첨 상품과 피규어 등 일반 구매 상품은 대상이 아닙니다.",
          "교환·환급·배송이 진행 중이거나 이미 배송된 상품은 신청 목록에 표시되지 않습니다.",
        ],
      },
      {
        heading: "무료배송 기준",
        paragraphs: [
          "가챠 상품만 묶어 신청할 때는 상품 합계 30,000원 이상이면 무료배송이 적용됩니다.",
          "쿠지·피규어 등 다른 상품이 하나라도 포함되면 상품 합계 50,000원 이상일 때 무료배송이 적용됩니다.",
        ],
      },
      {
        heading: "출고 후 처리",
        paragraphs: [
          "출고가 시작되면 배송 상세에서 택배사와 송장번호를 확인할 수 있습니다. 배송을 신청해 수령한 상품은 교환, 환불 또는 포인트 환급 대상이 아닙니다.",
        ],
      },
    ],
  },
  {
    id: "exchange-request",
    title: "교환방·신청방 운영정책",
    summary: "교환 제안과 원하는 상품 신청의 운영 기준",
    updatedAt: "2026.08.30",
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
    ],
  },
] as const;

export function findProfilePolicy(policyId: string): ProfilePolicy | null {
  return PROFILE_POLICIES.find((policy) => policy.id === policyId) ?? null;
}
