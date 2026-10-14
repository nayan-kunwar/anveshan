import type { ReactNode } from "react";

export default function Pager({
  page,
  pages,
  summary,
  onPrev,
  onNext,
}: {
  page: number;
  pages: number;
  summary: string;
  onPrev: () => void;
  onNext: () => void;
}): ReactNode {
  return (
    <div className="pager">
      <span className="small">{summary}</span>
      <div className="pager-actions">
        <button type="button" onClick={onPrev} disabled={page <= 1}>
          Previous
        </button>
        <button type="button" onClick={onNext} disabled={page >= pages}>
          Next
        </button>
      </div>
    </div>
  );
}
