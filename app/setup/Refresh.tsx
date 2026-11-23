"use client";
import { useRouter } from "next/navigation";
import { Button } from "../components/ui/Button";
export default function Refresh() { const r = useRouter(); return <Button variant="primary" onClick={() => r.refresh()}>Check again</Button>; }
