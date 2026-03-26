import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { errAsync, okAsync } from "neverthrow";
import type { CardTemplate } from "../../shared/domain/mod.ts";
import type { User } from "../../shared/domain/user.ts";
import { resolveTemplate } from "./resolve_template.ts";

function makeTemplate(id: number): CardTemplate {
  return {
    id,
    name: "Test Template",
    promptTemplate: "...",
    responseJsonSchema: "{}",
    ankiNoteType: "Basic",
    ankiFieldsMapping: "{}",
    isActive: true,
    createdAt: "2024-01-01",
  };
}

function makeUser(activeTemplateId: number | null = null): User {
  return { telegramId: 12345, firstName: "Test", languageCode: null, activeTemplateId, createdAt: "2024-01-01" };
}

const repoErr = { kind: "repository" as const, message: "DB error" };

describe("resolveTemplate", () => {
  it("falls back to findDefault when user is not found", async () => {
    const defaultTpl = makeTemplate(1);
    const result = await resolveTemplate(
      {
        upsert: () => okAsync(makeUser()),
        findByTelegramId: () => okAsync(null),
        updateActiveTemplate: () => okAsync(makeUser()),
      },
      { findById: () => okAsync(null), findDefault: () => okAsync(defaultTpl), create: () => okAsync(defaultTpl) },
      12345,
    );
    assertEquals(result._unsafeUnwrap(), defaultTpl);
  });

  it("falls back to findDefault when user has no activeTemplateId", async () => {
    const defaultTpl = makeTemplate(1);
    const result = await resolveTemplate(
      {
        upsert: () => okAsync(makeUser()),
        findByTelegramId: () => okAsync(makeUser(null)),
        updateActiveTemplate: () => okAsync(makeUser()),
      },
      { findById: () => okAsync(null), findDefault: () => okAsync(defaultTpl), create: () => okAsync(defaultTpl) },
      12345,
    );
    assertEquals(result._unsafeUnwrap(), defaultTpl);
  });

  it("uses findById with user activeTemplateId when set", async () => {
    const userTpl = makeTemplate(5);
    let findByIdCalledWith: number | undefined;
    const result = await resolveTemplate(
      {
        upsert: () => okAsync(makeUser()),
        findByTelegramId: () => okAsync(makeUser(5)),
        updateActiveTemplate: () => okAsync(makeUser()),
      },
      {
        findById: (id: number) => {
          findByIdCalledWith = id;
          return okAsync(userTpl);
        },
        findDefault: () => okAsync(null),
        create: () => okAsync(userTpl),
      },
      12345,
    );
    assertEquals(result._unsafeUnwrap(), userTpl);
    assertEquals(findByIdCalledWith, 5);
  });

  it("returns null when findDefault returns null", async () => {
    const result = await resolveTemplate(
      {
        upsert: () => okAsync(makeUser()),
        findByTelegramId: () => okAsync(null),
        updateActiveTemplate: () => okAsync(makeUser()),
      },
      { findById: () => okAsync(null), findDefault: () => okAsync(null), create: () => okAsync(makeTemplate(1)) },
      12345,
    );
    assertEquals(result._unsafeUnwrap(), null);
  });

  it("returns null when user activeTemplateId points to a non-existent template", async () => {
    const result = await resolveTemplate(
      {
        upsert: () => okAsync(makeUser()),
        findByTelegramId: () => okAsync(makeUser(99)),
        updateActiveTemplate: () => okAsync(makeUser()),
      },
      { findById: () => okAsync(null), findDefault: () => okAsync(null), create: () => okAsync(makeTemplate(1)) },
      12345,
    );
    assertEquals(result._unsafeUnwrap(), null);
  });

  it("propagates userRepo error", async () => {
    const result = await resolveTemplate(
      {
        upsert: () => okAsync(makeUser()),
        findByTelegramId: () => errAsync(repoErr),
        updateActiveTemplate: () => okAsync(makeUser()),
      },
      { findById: () => okAsync(null), findDefault: () => okAsync(null), create: () => okAsync(makeTemplate(1)) },
      12345,
    );
    assertEquals(result.isErr(), true);
    assertEquals(result._unsafeUnwrapErr(), repoErr);
  });

  it("propagates findDefault error", async () => {
    const result = await resolveTemplate(
      {
        upsert: () => okAsync(makeUser()),
        findByTelegramId: () => okAsync(null),
        updateActiveTemplate: () => okAsync(makeUser()),
      },
      { findById: () => okAsync(null), findDefault: () => errAsync(repoErr), create: () => okAsync(makeTemplate(1)) },
      12345,
    );
    assertEquals(result.isErr(), true);
  });

  it("propagates findById error", async () => {
    const result = await resolveTemplate(
      {
        upsert: () => okAsync(makeUser()),
        findByTelegramId: () => okAsync(makeUser(5)),
        updateActiveTemplate: () => okAsync(makeUser()),
      },
      { findById: () => errAsync(repoErr), findDefault: () => okAsync(null), create: () => okAsync(makeTemplate(1)) },
      12345,
    );
    assertEquals(result.isErr(), true);
  });
});
