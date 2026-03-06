import {
  adminUserResponseSchema,
  createAdminUserRequestSchema,
  listAdminUsersResponseSchema,
  updateAdminUserPasswordRequestSchema,
  type AdminUserResponse,
  type CreateAdminUserRequest,
  type UpdateAdminUserPasswordRequest,
} from "@scouting-platform/contracts";

const GENERIC_REQUEST_ERROR_MESSAGE = "Unable to complete the request. Please try again.";
const INVALID_RESPONSE_ERROR_MESSAGE = "Received an invalid response from the server.";

type ApiErrorBody = {
  error?: string;
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return GENERIC_REQUEST_ERROR_MESSAGE;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(response: Response, payload: unknown): string {
  if (payload && typeof payload === "object") {
    const maybeErrorPayload = payload as ApiErrorBody;
    if (typeof maybeErrorPayload.error === "string" && maybeErrorPayload.error.trim().length > 0) {
      return maybeErrorPayload.error;
    }
  }

  if (response.status === 401 || response.status === 403) {
    return "You are not authorized to manage users.";
  }

  return GENERIC_REQUEST_ERROR_MESSAGE;
}

export async function fetchAdminUsers(signal?: AbortSignal): Promise<AdminUserResponse[]> {
  try {
    const response = await fetch("/api/admin/users", {
      method: "GET",
      cache: "no-store",
      signal: signal ?? null,
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, payload));
    }

    const parsed = listAdminUsersResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data.users;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}

export async function createAdminUser(input: CreateAdminUserRequest): Promise<AdminUserResponse> {
  const requestPayload = createAdminUserRequestSchema.parse(input);

  try {
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, payload));
    }

    const parsed = adminUserResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}

export async function updateAdminUserPassword(
  userId: string,
  input: UpdateAdminUserPasswordRequest,
): Promise<AdminUserResponse> {
  const requestPayload = updateAdminUserPasswordRequestSchema.parse(input);

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    const payload = await readJsonPayload(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(response, payload));
    }

    const parsed = adminUserResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new Error(INVALID_RESPONSE_ERROR_MESSAGE);
    }

    return parsed.data;
  } catch (error) {
    throw new Error(normalizeErrorMessage(error));
  }
}
