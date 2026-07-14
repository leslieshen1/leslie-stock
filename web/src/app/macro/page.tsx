import MacroClient from "./MacroClient";

// 宏观驾驶舱(私密工具,不进导航、不收录):十个"指引宏观思维"的指标按传导地图四层实时呈现。口令同 /stats。
export const dynamic = "force-dynamic";
export const metadata = {
  title: "宏观驾驶舱",
  robots: { index: false, follow: false },
};

export default function MacroPage() {
  return (
    <main className="mx-auto max-w-[1180px] px-2 pb-10 pt-2 sm:px-4">
      <div className="rounded-lg border border-[#262b35] bg-[#101216] p-3 shadow-2xl sm:p-4">
        <MacroClient />
      </div>
    </main>
  );
}
