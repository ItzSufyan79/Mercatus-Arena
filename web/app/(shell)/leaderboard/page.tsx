import { EventBanner } from "@/components/EventBanner";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { api, type STATUS } from "@/lib/api";

export const revalidate = 1;

export default async function LeaderboardPage() {
  let status = null as STATUS | null;
  try {
    status = await api<STATUS>("/api/market/status");
  } catch {}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          Leaderboard
        </h1>
        <p className="mt-1 text-[13px] text-muted">
          Live portfolio rankings across all registered teams.
        </p>
      </div>
      <EventBanner status={status ?? { state: "PRE_LAUNCH" }} />
      <div className="max-w-3xl">
        <LeaderboardTable />
      </div>
    </div>
  );
}
