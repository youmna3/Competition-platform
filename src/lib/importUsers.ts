import type { Governorate } from "./types";
import { readSpreadsheet } from "./importTeams";

export const USER_IMPORT_HEADERS = [
  "Full Name",
  "Email",
  "Password",
  "Governorate",
] as const;

interface RawUser {
  fullName: string;
  email: string;
  password: string;
  governorate: string;
}
export interface ParsedUserImportRow extends RawUser {
  rowNumber: number;
  governorateCode: string;
  governorateName: string;
  errors: string[];
}

const aliases: Record<string, keyof RawUser> = {
  "full name": "fullName",
  full_name: "fullName",
  name: "fullName",
  email: "email",
  "e-mail": "email",
  password: "password",
  governorate: "governorate",
  governorate_name: "governorate",
};
const governorateAliases: Record<string, string> = {
  cairo: "CAI",
  cai: "CAI",
  alexandria: "ALX",
  alex: "ALX",
  alx: "ALX",
  monufia: "MNF",
  menofia: "MNF",
  menoufia: "MNF",
  monoufia: "MNF",
  mnf: "MNF",
  assiut: "AST",
  asyut: "AST",
  assuit: "AST",
  ast: "AST",
  suez: "SUZ",
  suz: "SUZ",
};
const emailPattern = /^\S+@\S+\.\S+$/;

export function passwordValidationError(password: string): string | null {
  return password.length < 12 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
    ? "Password must use at least 12 characters with uppercase, lowercase, a number and a symbol"
    : null;
}

export function normalizeUserGovernorate(
  value: string,
  governorates: Governorate[],
): Governorate | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const code = governorateAliases[normalized];
  return governorates.find(
    (item) =>
      item.code === code ||
      item.code.toLowerCase() === value.trim().toLowerCase() ||
      item.name.toLowerCase() === value.trim().toLowerCase(),
  );
}

export function buildUserImportRows(
  records: Record<string, unknown>[],
  governorates: Governorate[],
  existingEmails = new Set<string>(),
): { rows: ParsedUserImportRow[]; headerErrors: string[] } {
  if (!records.length)
    return { rows: [], headerErrors: ["The file contains no data rows"] };
  const mapping = new Map<string, keyof RawUser>();
  for (const header of Object.keys(records[0])) {
    const normalized = header.trim().toLowerCase().replace(/\s+/g, " ");
    const key = aliases[normalized] ?? aliases[normalized.replace(/ /g, "_")];
    if (key && ![...mapping.values()].includes(key)) mapping.set(header, key);
  }
  const required = Object.values(aliases).filter(
    (value, index, all) => all.indexOf(value) === index,
  );
  const headerErrors = required
    .filter((key) => ![...mapping.values()].includes(key))
    .map(
      (key) => `Missing column: ${USER_IMPORT_HEADERS[required.indexOf(key)]}`,
    );
  if (headerErrors.length) return { rows: [], headerErrors };

  const seen = new Set<string>();
  const rows: ParsedUserImportRow[] = [];
  records.forEach((record, index) => {
    const raw: RawUser = {
      fullName: "",
      email: "",
      password: "",
      governorate: "",
    };
    for (const [header, key] of mapping)
      raw[key] = String(record[header] ?? "").trim();
    if (Object.values(raw).every((value) => !value)) return;
    const email = raw.email.toLowerCase();
    const governorate = normalizeUserGovernorate(raw.governorate, governorates);
    const errors: string[] = [];
    if (!raw.fullName) errors.push("Full Name is required");
    if (!emailPattern.test(email)) errors.push("A valid Email is required");
    if (!raw.password) errors.push("Password is required");
    else {
      const passwordError = passwordValidationError(raw.password);
      if (passwordError) errors.push(passwordError);
    }
    if (!governorate)
      errors.push(
        "Governorate must be Cairo, Alexandria, Monufia, Assiut or Suez",
      );
    if (email && seen.has(email))
      errors.push("Duplicate e-mail in uploaded file");
    if (existingEmails.has(email)) errors.push("Account already exists");
    seen.add(email);
    rows.push({
      ...raw,
      email,
      rowNumber: index + 1,
      governorateCode: governorate?.code ?? "",
      governorateName: governorate?.name ?? raw.governorate,
      errors,
    });
  });
  return { rows, headerErrors };
}

export async function readUserSpreadsheet(file: File) {
  return readSpreadsheet(file);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
export function downloadUserCsv(
  filename: string,
  rows: {
    fullName: string;
    email: string;
    password?: string;
    governorate: string;
  }[] = [],
) {
  const lines = [
    USER_IMPORT_HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      [row.fullName, row.email, row.password ?? "", row.governorate]
        .map(csvCell)
        .join(","),
    ),
  ];
  const url = URL.createObjectURL(
    new Blob([`\uFEFF${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
