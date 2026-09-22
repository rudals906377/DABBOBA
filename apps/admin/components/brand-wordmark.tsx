import wordmark from "../../../public/assets/dabboba/brand/dabboba-wordmark.png";

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <img
      alt="DABBOBA"
      className={`brand-wordmark ${className}`.trim()}
      height={172}
      src={wordmark.src}
      width={1170}
    />
  );
}
