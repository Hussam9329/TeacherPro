import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main
      className="app-bg flex min-h-screen items-center justify-center p-6"
      dir="rtl"
    >
      <Card className="w-full max-w-xl border-primary/20 bg-card/90 text-center shadow-xl backdrop-blur-xl">
        <CardContent className="space-y-6 p-8">
          <div className="mx-auto flex size-20 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-4xl font-black text-primary">
            404
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-gradient-brand">
              الصفحة غير موجودة
            </h1>
            <p className="text-sm leading-7 text-muted-foreground">
              الرابط الذي أدخلته غير صحيح أو تم نقله. يمكنك الرجوع إلى الصفحة
              الرئيسية ومتابعة العمل من داخل النظام.
            </p>
          </div>
          <Button asChild size="lg" className="min-w-48 rounded-2xl">
            <Link href="/">العودة للرئيسية</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
