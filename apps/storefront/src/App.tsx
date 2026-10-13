import {
  BellIcon,
  BookmarkFilledIcon,
  BookmarkIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { launchCopy } from "./launch-copy";

type SectionId = "hero" | "experience" | "favorites" | "storage" | "prelaunch";

type SectionMeta = {
  id: SectionId;
  label: string;
  nextId?: SectionId;
  nextLabel?: string;
};

const sections: readonly SectionMeta[] = [
  { id: "hero", label: "처음", nextId: "experience", nextLabel: "앱 화면 미리보기" },
  { id: "experience", label: "가챠샵", nextId: "favorites", nextLabel: "관심 상품 기능 보기" },
  { id: "favorites", label: "관심 상품", nextId: "storage", nextLabel: "보관·배송 안내 보기" },
  { id: "storage", label: "보관·배송", nextId: "prelaunch", nextLabel: launchCopy.finalNavLabel },
  { id: "prelaunch", label: "이용 안내" },
] as const;

function useActiveSection() {
  const [activeSection, setActiveSection] = useState<SectionId>("hero");

  useEffect(() => {
    const visibility = new Map<SectionId, number>(sections.map((section) => [section.id, 0]));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibility.set(entry.target.id as SectionId, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        const visible = sections.reduce((best, section) => {
          const ratio = visibility.get(section.id) ?? 0;
          return ratio > best.ratio ? { id: section.id, ratio } : best;
        }, { id: "hero" as SectionId, ratio: -1 });
        if (visible.ratio > 0) setActiveSection(visible.id);
      },
      { threshold: Array.from({ length: 11 }, (_, index) => index / 10) },
    );
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return activeSection;
}

function Brand({ onDark = false }: { onDark?: boolean }) {
  return (
    <img
      className={onDark ? "brand-logo brand-logo--on-dark" : "brand-logo"}
      src="/assets/brand/dabboba-wordmark.png"
      alt="DABBOBA"
      width={1170}
      height={172}
    />
  );
}

function SiteHeader() {
  return (
    <header className="site-header">
      <a className="site-header__brand" href="#hero" aria-label="다뽀바 처음 화면으로 이동">
        <Brand />
      </a>
      <nav className="site-nav" aria-label="페이지 안내">
        <a href="#experience">앱 미리보기</a>
        <a href="#storage">보관·배송</a>
        <a href="#prelaunch">이용 안내</a>
        <a href="/review/">심사용 웹앱</a>
      </nav>
    </header>
  );
}

function PageDots({ activeSection }: { activeSection: SectionId }) {
  return (
    <nav className="page-dots" aria-label="소개 화면 바로가기">
      {sections.map((section) => (
        <a
          key={section.id}
          aria-current={section.id === activeSection ? "step" : undefined}
          aria-label={`${section.label} 화면으로 이동`}
          href={`#${section.id}`}
        />
      ))}
    </nav>
  );
}

function ScrollCue({ href }: { href: `#${SectionId}` }) {
  return (
    <a className="scroll-cue" href={href}>
      <span>아래로 내려 더 보기</span>
      <ChevronDownIcon aria-hidden="true" />
    </a>
  );
}

function FloatingAction({ activeSection }: { activeSection: SectionId }) {
  const active = sections.find((section) => section.id === activeSection);
  if (!active?.nextId || !active.nextLabel) return null;
  return (
    <a className="floating-action" href={`#${active.nextId}`}>
      <span>{active.nextLabel}</span>
      <ChevronRightIcon aria-hidden="true" />
    </a>
  );
}

function PixelSpark({ className = "" }: { className?: string }) {
  return <span className={`pixel-spark ${className}`} aria-hidden="true">＋</span>;
}

function HeroSection() {
  return (
    <section className="story-section story-section--hero" id="hero" aria-labelledby="hero-title">
      <div className="story-grid story-grid--hero">
        <div className="story-copy story-copy--hero">
          <h1 id="hero-title">원하는 거 다 뽀바</h1>
          <p>원하는 캐릭터 상품을 직접 고르고 구매해요.</p>
          <span className="status-line"><span aria-hidden="true" />{launchCopy.heroStatus}</span>
        </div>
        <div className="hero-machine" aria-hidden="true">
          <PixelSpark className="pixel-spark--one" />
          <PixelSpark className="pixel-spark--two" />
          <img
            src="/assets/gacha/capsule-machine.png"
            alt=""
            width={941}
            height={1672}
            decoding="async"
            fetchPriority="high"
          />
        </div>
      </div>
      <ScrollCue href="#experience" />
    </section>
  );
}

function AppPreview() {
  const navItems = [
    ["/assets/nav/gacha.png", "가챠샵"],
    ["/assets/nav/home.png", "홈"],
    ["/assets/nav/storage.png", "보관함"],
    ["/assets/nav/profile.png", "내정보"],
  ] as const;
  return (
    <div className="phone-preview" aria-hidden="true">
      <div className="phone-preview__camera" />
      <div className="phone-preview__screen">
        <div className="phone-preview__status"><strong>10:08</strong><span>5G&nbsp;&nbsp;76</span></div>
        <div className="phone-preview__header">
          <img src="/assets/brand/dabboba-wordmark.png" alt="" width={1170} height={172} />
          <div><MagnifyingGlassIcon /><BellIcon /></div>
        </div>
        <div className="phone-preview__event">
          <div>
            <strong>새 소식을<br />준비하고 있어요.</strong>
            <span>새 이벤트는 이곳에서 알려드릴게요.</span>
          </div>
          <img
            src="/assets/gacha/capsule-machine.png"
            alt=""
            width={941}
            height={1672}
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="phone-preview__section-heading"><strong>마음에 드는 상품을 골라보세요</strong><span>전체보기</span></div>
        <div className="preview-products">
          <PreviewProduct image="/assets/gacha/capsule.png" title="캡슐 컬렉션" status={launchCopy.gachaPreviewStatus} />
          <PreviewProduct image="/assets/gacha/capsule.png" title="캐릭터 컬렉션" status={launchCopy.gachaPreviewStatus} />
        </div>
        <div className="phone-preview__nav">
          {navItems.map(([image, label], index) => (
            <div key={label} className={index === 0 ? "is-active" : ""}>
              <img src={image} alt="" loading="lazy" decoding="async" /><span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewProduct({ image, title, status }: { image: string; title: string; status: string }) {
  return (
    <div className="preview-product">
      <div className="preview-product__media"><img src={image} alt="" loading="lazy" decoding="async" /></div>
      <div className="preview-product__title"><strong>{title}</strong><BookmarkIcon /></div>
      <span>{status}</span>
    </div>
  );
}

function ExperienceSection() {
  return (
    <section className="story-section" id="experience" aria-labelledby="experience-title">
      <div className="story-grid">
        <div className="story-copy">
          <span className="section-label section-label--gacha">가챠샵</span>
          <h2 id="experience-title">원하는 상품을 직접 선택해요</h2>
          <p>상품의 사진과 종류, 가격을 확인하고 원하는 상품과 수량을 선택한 뒤 결제해요.</p>
        </div>
        <div className="story-media story-media--phone"><AppPreview /></div>
      </div>
      <ScrollCue href="#favorites" />
    </section>
  );
}

const favoriteRows = [
  ["캡슐 컬렉션", "원하는 종류를 골라 구매해요.", true],
  ["캐릭터 컬렉션", "사진으로 원하는 종류를 확인해요.", false],
  ["새로 들어온 가챠", "관심 상품으로 저장해 다시 확인해요.", true],
] as const;

function FavoritesPanel() {
  return (
    <div className="favorites-stage" aria-hidden="true">
      <PixelSpark className="pixel-spark--favorites" />
      <img className="floating-capsule floating-capsule--left" src="/assets/gacha/capsule.png" alt="" aria-hidden="true" loading="lazy" decoding="async" />
      <div className="favorites-panel">
        <div className="favorites-panel__heading">
          <strong>관심 상품</strong><span>{favoriteRows.filter((row) => row[2]).length}개 저장</span>
        </div>
        {favoriteRows.map(([title, description, selected]) => (
          <div className="favorite-row" key={title}>
            <div className="favorite-row__thumb">
              <img
                src="/assets/gacha/capsule.png"
                alt=""
                loading="lazy"
                decoding="async"
              />
            </div>
            <div><strong>{title}</strong><span>{description}</span></div>
            {selected ? <BookmarkFilledIcon className="favorite-row__saved" /> : <BookmarkIcon />}
          </div>
        ))}
      </div>
      <img className="floating-capsule floating-capsule--right" src="/assets/gacha/capsule.png" alt="" aria-hidden="true" loading="lazy" decoding="async" />
    </div>
  );
}

function FavoritesSection() {
  return (
    <section className="story-section" id="favorites" aria-labelledby="favorites-title">
      <div className="story-grid story-grid--reverse">
        <div className="story-copy">
          <span className="section-label section-label--gacha">관심 상품</span>
          <h2 id="favorites-title">마음에 든 상품은 한곳에</h2>
          <p>저장해 둔 상품을 다시 찾아보고 원하는 종류를 골라요.</p>
        </div>
        <div className="story-media"><FavoritesPanel /></div>
      </div>
      <ScrollCue href="#storage" />
    </section>
  );
}

function StorageBoard() {
  return (
    <div className="storage-board">
      <div className="storage-board__icon"><CalendarIcon aria-hidden="true" /></div>
      <div className="storage-board__intro"><span>{launchCopy.storageIntro}</span><strong>구매일부터 60일 보관</strong></div>
      <dl>
        <div><dt>상품 합계</dt><dd>24,900원 이상 무료 배송</dd></div>
        <div><dt>무료 기준 미달</dt><dd>배송비 3,000원</dd></div>
      </dl>
      <p>신청 전 보관 기간과 배송 금액을 다시 확인할 수 있어요.</p>
    </div>
  );
}

function StorageSection() {
  return (
    <section className="story-section story-section--storage" id="storage" aria-labelledby="storage-title">
      <div className="story-grid">
        <div className="story-copy">
          <span className="section-label section-label--gacha">보관·배송</span>
          <h2 id="storage-title">고른 상품, 모아서 한 번에 받아요</h2>
          <p>보관 기간과 배송 기준을 숨기지 않고 신청 전에 분명하게 알려드려요.</p>
        </div>
        <div className="story-media"><StorageBoard /></div>
      </div>
      <ScrollCue href="#prelaunch" />
    </section>
  );
}

function PrelaunchSection() {
  return (
    <section className="story-section story-section--prelaunch" id="prelaunch" aria-labelledby="prelaunch-title">
      <div className="prelaunch-content">
        <Brand onDark />
        <div className="prelaunch-copy">
          <h2 id="prelaunch-title">{launchCopy.closingTitle}</h2>
          <p>{launchCopy.closingBody}</p>
        </div>
        <div className="prelaunch-art" aria-hidden="true">
          <img className="prelaunch-art__capsule prelaunch-art__capsule--one" src="/assets/gacha/capsule.png" alt="" width={256} height={256} loading="lazy" decoding="async" />
          <img className="prelaunch-art__capsule prelaunch-art__capsule--two" src="/assets/gacha/capsule.png" alt="" width={256} height={256} loading="lazy" decoding="async" />
        </div>
        <span className="prelaunch-status"><span aria-hidden="true" />{launchCopy.closingStatus}</span>
        <a className="prelaunch-action" href="/support">고객지원 보기<ChevronRightIcon aria-hidden="true" /></a>
        <footer className="site-footer">
          <nav aria-label="정책과 고객지원">
            <a href="/terms">이용약관</a>
            <a href="/privacy">개인정보처리방침</a>
            <a href="/support">고객지원</a>
            <a href="/account-deletion">계정 삭제</a>
          </nav>
          <p>다뽀바 · 대표 김정미 · 사업자등록번호 508-33-01724 · 통신판매업 2026-경기파주-3579</p>
          <p>경기도 파주시 한빛로 67, 208-501 · 대표전화 <a href="tel:0319479996">031-947-9996</a></p>
          <p><a href="/review/">서비스 심사용 웹앱</a> · © DABBOBA</p>
        </footer>
      </div>
    </section>
  );
}

export function App() {
  const activeSection = useActiveSection();
  const activeIndex = useMemo(() => sections.findIndex((section) => section.id === activeSection), [activeSection]);

  return (
    <>
      <a className="skip-link" href="#hero">본문으로 바로가기</a>
      <SiteHeader />
      <main data-active-section={activeIndex + 1}>
        <HeroSection />
        <ExperienceSection />
        <FavoritesSection />
        <StorageSection />
        <PrelaunchSection />
      </main>
      <PageDots activeSection={activeSection} />
      <FloatingAction activeSection={activeSection} />
    </>
  );
}
