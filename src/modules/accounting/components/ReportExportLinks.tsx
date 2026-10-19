import { Button } from "@/components/ui/button";

type ReportExportLinksProps = {
  path: string;
  filters: Record<string, string | undefined>;
};

export function ReportExportLinks({ path, filters }: ReportExportLinksProps) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }

  const href = (format: "xlsx" | "pdf") => {
    const params = new URLSearchParams(query);
    params.set("format", format);
    return `${path}?${params.toString()}`;
  };

  return (
    <div className="report-export-actions flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={href("xlsx")} download>
          Export Excel
        </a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={href("pdf")} download>
          Export PDF
        </a>
      </Button>
    </div>
  );
}
