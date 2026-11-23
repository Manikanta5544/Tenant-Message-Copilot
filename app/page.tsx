import type { Metadata } from "next";
import Workbench from "./components/Workbench";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };
export default function Home() { return <Workbench />; }
