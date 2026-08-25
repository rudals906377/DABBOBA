import { MigrationScreen } from "@/components/MigrationScreen";

export default function ProfileRoute() {
  return (
    <MigrationScreen
      eyebrow="PROFILE"
      title="프로필"
      description="Supabase Auth와 canonical 회원 ID 연결 후 보관함·배송·구매·포인트 화면을 이전합니다."
    />
  );
}
