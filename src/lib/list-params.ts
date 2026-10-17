export type ListSearchParams = Record<string, string | string[] | undefined>;

export type ListParams = {
  page: number;
  pageSize: 10 | 25 | 50;
  search?: string;
};

const PAGE_SIZES = [10, 25, 50] as const;

function singleValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export function parseListParams(searchParams: ListSearchParams): ListParams {
  const pageValue = singleValue(searchParams.page);
  const parsedPage = pageValue && /^\d+$/.test(pageValue) ? Number(pageValue) : NaN;
  const page = Number.isSafeInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const pageSizeValue = singleValue(searchParams.pageSize);
  const parsedPageSize =
    pageSizeValue && /^\d+$/.test(pageSizeValue) ? Number(pageSizeValue) : NaN;
  const pageSize = PAGE_SIZES.find((size) => size === parsedPageSize) ?? 10;
  const search = singleValue(searchParams.search)?.trim();

  return { page, pageSize, search: search || undefined };
}

export function buildQueryString(
  searchParams: ListSearchParams,
  updates: Record<string, string | string[] | undefined> = {}
) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else {
      query.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    query.delete(key);
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else {
      query.set(key, value);
    }
  }

  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}
