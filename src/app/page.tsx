import { listItems } from "@/lib/db";
import { Workspace } from "./workspace";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Workspace initialItems={listItems()} />;
}
