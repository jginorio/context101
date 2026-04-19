"use client";

import Papa from "papaparse";
import * as React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function CsvPreview({ content }: { content: string }) {
  const { rows, header, error } = React.useMemo(() => {
    try {
      const parsed = Papa.parse<string[]>(content.trim(), {
        skipEmptyLines: true,
      });
      const [first, ...rest] = parsed.data ?? [];
      return {
        header: first ?? [],
        rows: rest,
        error: parsed.errors[0]?.message ?? null,
      };
    } catch (e) {
      return {
        header: [],
        rows: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [content]);

  if (error && rows.length === 0) {
    return (
      <p className="text-sm text-destructive">Could not parse CSV: {error}</p>
    );
  }

  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {header.map((h, i) => (
              <TableHead key={i} className="whitespace-nowrap font-semibold">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell key={j} className="whitespace-nowrap">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
