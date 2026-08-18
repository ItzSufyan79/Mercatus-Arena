import { TerminalShell } from "@/components/TerminalShell";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TerminalShell>{children}</TerminalShell>;
}
