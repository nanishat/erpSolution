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
    <div className="flex gap-3 text-sm">
      <a
        href={href("xlsx")}
        download
        className="text-primary underline underline-offset-4"
      >
        Export Excel
      </a>
      <a
        href={href("pdf")}
        download
        className="text-primary underline underline-offset-4"
      >
        Export PDF
      </a>
    </div>
  );
}
