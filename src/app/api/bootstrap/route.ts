export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getAuthPrincipal,
  hasPermission,
  unauthorizedResponse,
} from "@/lib/server-auth";
import { assertDatabaseSchemaReady } from "@/lib/schema-readiness";
import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";
import { routeErrorResponse } from "@/lib/route-helpers";

/**
 * Initial metadata in one browser request and one session lookup. Keep each
 * permission and metadata projection aligned with the resource GET routes.
 * Student, Grade and opportunity data remain owned by their paginated screens.
 */
export async function GET(req: NextRequest) {
  try {
    const principal = await getAuthPrincipal(req);
    if (!principal) return unauthorizedResponse();

    const loaders: Array<Promise<Record<string, unknown>>> = [];
    if (hasPermission(principal, "courses.view")) {
      loaders.push(
        db.course.findMany({ orderBy: { createdAt: "desc" } })
          .then((courses) => ({ courses })),
      );
    }
    if (hasPermission(principal, "chapters.view")) {
      loaders.push(
        db.chapter.findMany({
          orderBy: { name: "asc" },
          include: { courseLinks: true },
        }).then((chapters) => ({ chapters })),
      );
    }
    if (hasPermission(principal, "exams.view")) {
      loaders.push((async () => {
        await assertDatabaseSchemaReady();
        const exams = await db.exam.findMany({
          include: { examCourses: true },
          orderBy: { date: "desc" },
        });
        return {
          exams: exams.map((exam) => ({
            ...exam,
            mutationToken: buildMutationPreviewToken(`exam-edit:${exam.id}`, exam),
          })),
        };
      })());
    }
    if (["accounts.view", "accounts.users.view"].some((permission) => hasPermission(principal, permission))) {
      loaders.push(
        db.appUser.findMany({
          orderBy: { name: "asc" },
          // Account metadata only: audit history has its own paginated endpoint.
          // Never select passwordHash or sessionVersion.
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
            roleId: true,
            permissions: true,
            active: true,
            createdAt: true,
            roleRef: true,
          },
        }).then((users) => ({ users })),
      );
    }
    if (["accounts.view", "accounts.roles.view"].some((permission) => hasPermission(principal, permission))) {
      loaders.push(
        db.role.findMany({
          orderBy: { name: "asc" },
          include: { users: { select: { id: true, name: true } } },
        }).then((roles) => ({ roles })),
      );
    }

    const parts = await Promise.all(loaders);
    return NextResponse.json(Object.assign({}, ...parts), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل بيانات بدء النظام. حاول مرة أخرى.");
  }
}
