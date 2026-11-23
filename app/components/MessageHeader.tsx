// "use client";
// import { useState } from "react";
// import type { InboxRow } from "../lib/types";
// import { Avatar } from "./ui/Avatar";
// import { Button } from "./ui/Button";
// import { Chip } from "./ui/Chip";
// import { Icon } from "./ui/Icon";
// import { cx } from "./ui/cx";

// /** Sticky header of the detail pane: who wrote, in which language, and the message itself. */
// export default function MessageHeader({ row, onBack }: { row: InboxRow; onBack: () => void }) {
//   const [more, setMore] = useState(false);
//   const long = row.text.length > 220;
//   return (
//     <div className="sticky top-14 z-20 -mx-4 border-b border-border bg-bg/95 px-4 pb-3 pt-3 backdrop-blur lg:mx-0 lg:rounded-card lg:border lg:bg-surface lg:p-4 lg:shadow-e1">
//       <Button variant="ghost" small className="mb-2 -ml-2 lg:hidden" onClick={onBack}><Icon name="back" size={15} />Back to inbox</Button>
//       <div className="flex items-start gap-3">
//         <Avatar name={row.resident_name} size="lg" />
//         <div className="min-w-0 flex-1">
//           <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base"><b>{row.resident_name}</b><span className="text-muted">Unit {row.unit}</span><Chip>Writes in {row.preferred_language}</Chip>{row.scenario_label && <Chip tone="accent">{row.scenario_label}</Chip>}</p>
//           <p lang={row.preferred_language === "Telugu" ? "te" : row.preferred_language === "Hindi" ? "hi" : "en"} className={cx("mt-1.5 text-lg", !more && long && "line-clamp-3")}>{row.text}</p>
//           {long && <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 min-h-8 text-sm font-medium text-accent hover:underline">{more ? "Show less" : "Show more"}</button>}
//         </div>
//       </div>
//     </div>
//   );
// }
