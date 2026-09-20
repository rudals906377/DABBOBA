export type BusinessInformation = Readonly<{
  businessName: string;
  representativeName: string;
  businessRegistrationNumber: string;
  businessAddress: string;
  representativePhone: string;
  mailOrderRegistrationNumber: string;
}>;

export const BUSINESS_INFORMATION: BusinessInformation = {
  businessName: "다뽀바",
  representativeName: "김정미",
  businessRegistrationNumber: "508-33-01724",
  businessAddress: "경기도 파주시 한빛로 67, 208-501",
  representativePhone: "010-6374-4900",
  mailOrderRegistrationNumber: "2026-경기파주-3579",
};
