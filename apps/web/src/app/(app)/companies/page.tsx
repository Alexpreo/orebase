import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listCompanies } from "@/lib/intel";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const companies = await listCompanies();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Issuers resolved from extracted filings.
        </p>
      </div>

      {companies.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No companies yet</CardTitle>
            <CardDescription>
              Structured extraction has not created any company rows.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">CIK</th>
                <th className="py-2 pr-4 font-medium text-right">Projects</th>
                <th className="py-2 font-medium text-right">Filings</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="border-b">
                  <td className="py-2 pr-4">
                    <Link href={`/companies/${company.id}`} className="font-medium hover:underline">
                      {company.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{company.cik ?? "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{company.project_count}</td>
                  <td className="py-2 text-right tabular-nums">{company.document_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
