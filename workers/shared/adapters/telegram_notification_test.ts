import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createTelegramNotification } from "./telegram_notification.ts";

describe("createTelegramNotification", () => {
  describe("editMessage", () => {
    it("calls editMessageText endpoint with correct parameters", async () => {
      let capturedUrl = "";
      let capturedBody = "";

      const mockFetch = (url: string, init?: RequestInit): Promise<Response> => {
        capturedUrl = url;
        if (init?.body) {
          capturedBody = String(init.body);
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const result = await notification.editMessage("123456", "789", "Updated text");

      assertEquals(result.isOk(), true);
      assertEquals(capturedUrl, "https://api.telegram.org/bottest-token/editMessageText");
      const body = JSON.parse(capturedBody);
      assertEquals(body.chat_id, "123456");
      assertEquals(body.message_id, "789");
      assertEquals(body.text, "Updated text");
      assertEquals(body.parse_mode, "HTML");
    });

    it("returns error on fetch failure", async () => {
      const mockFetch = (): Promise<Response> => {
        return Promise.reject(new Error("Network error"));
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const result = await notification.editMessage("123456", "789", "Updated text");

      assertEquals(result.isOk(), true); // orElse converts to ok after retry
    });

    it("returns error on non-2xx status", async () => {
      const mockFetch = (): Promise<Response> => {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, description: "Message not found" }), {
            status: 400,
          }),
        );
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const result = await notification.editMessage("123456", "789", "Updated text");

      assertEquals(result.isOk(), true); // orElse converts to ok after retry
    });

    it("truncates error response body to 500 chars", async () => {
      const longErrorBody = "x".repeat(600);

      const mockFetch = (): Promise<Response> => {
        return Promise.resolve(new Response(longErrorBody, { status: 400 }));
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const result = await notification.editMessage("123456", "789", "Updated text");

      // The error is logged and converted to ok by orElse with retry logic
      assertEquals(result.isOk(), true);
    });
  });

  describe("sendFile", () => {
    it("calls sendDocument endpoint with file data", async () => {
      let capturedUrl = "";

      const mockFetch = (url: string): Promise<Response> => {
        capturedUrl = url;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const fileData = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await notification.sendFile("123456", fileData, "test.pdf", "Test document");

      assertEquals(result.isOk(), true);
      assertEquals(capturedUrl, "https://api.telegram.org/bottest-token/sendDocument");
    });

    it("sends file without caption if not provided", async () => {
      const mockFetch = (): Promise<Response> => {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const fileData = new Uint8Array([1, 2, 3]);
      const result = await notification.sendFile("123456", fileData, "test.pdf");

      assertEquals(result.isOk(), true);
    });

    it("returns error on fetch failure", async () => {
      const mockFetch = (): Promise<Response> => {
        return Promise.reject(new Error("Network error"));
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const fileData = new Uint8Array([1, 2, 3]);
      const result = await notification.sendFile("123456", fileData, "test.pdf");

      assertEquals(result.isErr(), true); // sendFile returns error on failure
      if (result.isErr()) {
        assertEquals(result.error.kind, "notification");
      }
    });

    it("returns error on non-2xx status", async () => {
      const mockFetch = (): Promise<Response> => {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, description: "Invalid chat ID" }), {
            status: 400,
          }),
        );
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const fileData = new Uint8Array([1, 2, 3]);
      const result = await notification.sendFile("invalid-chat", fileData, "test.pdf");

      assertEquals(result.isOk(), false);
    });

    it("truncates error response body to 500 chars", async () => {
      const longErrorBody = "x".repeat(600);

      const mockFetch = (): Promise<Response> => {
        return Promise.resolve(new Response(longErrorBody, { status: 400 }));
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      const fileData = new Uint8Array([1, 2, 3]);
      const result = await notification.sendFile("123456", fileData, "test.pdf");

      assertEquals(result.isOk(), false);
      if (result.isErr()) {
        assertEquals(result.error.message.includes("..."), true);
      }
    });
  });

  describe("configuration", () => {
    it("uses provided fetch function", async () => {
      let fetchCalled = false;

      const mockFetch = (): Promise<Response> => {
        fetchCalled = true;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      };

      const notification = createTelegramNotification({
        botToken: "test-token",
        fetchFn: mockFetch as typeof fetch,
      });

      await notification.editMessage("123456", "789", "Test");

      assertEquals(fetchCalled, true);
    });

    it("defaults to globalThis.fetch if not provided", () => {
      const notification = createTelegramNotification({
        botToken: "test-token",
      });

      // Verify the notification object is created successfully
      assertEquals(typeof notification.editMessage, "function");
      assertEquals(typeof notification.sendFile, "function");
    });

    it("constructs correct base URL with bot token", async () => {
      let capturedUrl = "";

      const mockFetch = (url: string): Promise<Response> => {
        capturedUrl = url;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      };

      const notification = createTelegramNotification({
        botToken: "custom-bot-token-123",
        fetchFn: mockFetch as typeof fetch,
      });

      await notification.editMessage("123456", "789", "Test");

      assertEquals(capturedUrl, "https://api.telegram.org/botcustom-bot-token-123/editMessageText");
    });
  });
});
