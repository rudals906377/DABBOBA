import Link from "next/link";

export default function NotFound() {
  return <main className="loading-state"><div><h1>페이지를 찾을 수 없습니다.</h1><Link className="button-link" href="/">대시보드로 돌아가기</Link></div></main>;
}
