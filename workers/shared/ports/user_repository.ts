import type { ResultAsync } from "neverthrow";
import type { NewUser, User } from "../domain/mod.ts";
import type { RepositoryError } from "../domain/errors.ts";

export interface UserRepositoryPort {
  upsert(user: NewUser): ResultAsync<User, RepositoryError>;
}
