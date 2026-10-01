import Link from "next/link";
import { statusLabel, Feedback, PageHeader, ReasonField, ReturnTo, StatusBadge, formatDate, shortId } from "../../../../components/operations";
import { answerInquiry } from "../../../../lib/actions";
import { adminApi } from "../../../../lib/api";
import { requireCapability } from "../../../../lib/auth";
import type { InquiryDetail, InquiryMessage, SearchParams } from "../../../../lib/admin-types";

export default async function InquiryDetailPage({ params, searchParams }: { params: Promise<{ inquiryId: string }>; searchParams: Promise<SearchParams> }) {
  const { inquiryId } = await params; const query = await searchParams;
  const session = await requireCapability("inquiries.manage");
  const inquiry = await adminApi<InquiryDetail>(`/v1/admin/inquiries/${encodeURIComponent(inquiryId)}`, { token: session.token });
  const returnTo = `/inquiries/${encodeURIComponent(inquiryId)}`;
  return <>
    <PageHeader eyebrow={inquiry.category} title={inquiry.title} description={`문의 ${shortId(inquiry.id)} · 사용자 ${shortId(inquiry.userId)} · ${formatDate(inquiry.createdAt)}`} actions={<><StatusBadge value={inquiry.status} /><Link className="button-link" href="/inquiries">목록으로</Link></>} />
    <Feedback searchParams={query} />
    <section className="panel"><div className="panel-heading"><div><h2>대화 기록</h2><p>작성자 역할과 작성 시각을 기준으로 표시합니다.</p></div></div>
      <div className="message-list">{inquiry.messages.map((message: InquiryMessage) => <article className="message" data-role={message.authorRole} key={message.id}><header><strong>{message.authorRole}</strong><span>{shortId(message.authorId)} · {formatDate(message.createdAt)}</span></header><p>{message.content}</p>{message.mediaIds.length ? <p className="muted">첨부 {message.mediaIds.map((mediaId, index) => <span key={mediaId}>{index ? " · " : ""}<a href={`/api/media/${encodeURIComponent(mediaId)}`} target="_blank" rel="noreferrer noopener">이미지 {index + 1}</a></span>)}</p> : null}</article>)}</div>
    </section>
    {inquiry.status === "CLOSED" ? <section className="panel"><div className="panel-heading"><div><h2>종료된 문의</h2><p>종료된 문의에는 답변을 추가할 수 없습니다. 사용자가 새 문의를 접수하면 새 대화에서 처리하세요.</p></div></div></section> : <section className="panel"><div className="panel-heading"><div><h2>답변 등록</h2><p>답변과 문의 상태가 서버에서 함께 기록됩니다.</p></div></div>
      <form className="stack-form" action={answerInquiry}><input type="hidden" name="inquiryId" value={inquiry.id} /><ReturnTo value={returnTo} />
        <label>답변<textarea name="content" maxLength={10000} required /></label><label>답변 후 상태<select name="status" defaultValue="ANSWERED">{["IN_PROGRESS", "ANSWERED", "CLOSED"].map((v) => <option key={v} value={v}>{statusLabel(v)}</option>)}</select></label>
        <p className="muted">운영자 답변 첨부 업로드는 아직 제공되지 않습니다. 사용자가 보낸 기존 첨부는 위 대화 기록에서 안전한 미디어 프록시로 확인할 수 있습니다.</p><label className="check-field"><input type="checkbox" name="isInternal" /> 사용자에게 보이지 않는 내부 메모</label>
        <ReasonField label="답변 처리 사유" /><div className="form-actions"><button className="primary">답변 등록</button></div>
      </form>
    </section>}
  </>;
}
