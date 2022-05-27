/*
* quartopub.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { quartoConfig } from "../../core/quarto.ts";
import { withRetry } from "../../core/retry.ts";
import {
  AuthorizationHandler,
  authorizeAccessToken,
  readAccessToken,
} from "../common/account.ts";
import { handlePublish, PublishHandler } from "../common/publish.ts";
import {
  AccountToken,
  AccountTokenType,
  PublishFiles,
  PublishProvider,
} from "../provider.ts";
import { PublishRecord } from "../types.ts";
import { AccessToken, QuartopubClient, Ticket } from "./api/index.ts";

export const kQuartopub = "quartopub";

export const kQuartoPubAuthTokenVar = "QUARTOPUB_AUTH_TOKEN";

export const quartopubProvider: PublishProvider = {
  name: kQuartopub,
  description: "Quarto Pub",
  accountTokens,
  authorizeToken,
  resolveTarget,
  publish,
  isUnauthorized,
};

function accountTokens() {
  const envTk = environmentAuthToken();
  const accessTk = accessToken();

  const accounts: AccountToken[] = [];
  if (envTk) {
    accounts.push({
      type: AccountTokenType.Environment,
      name: kQuartoPubAuthTokenVar,
      token: envTk,
    });
  }
  if (accessTk) {
    accounts.push({
      type: AccountTokenType.Authorized,
      name: accessTk.email!,
      token: accessTk.userToken,
    });
  }

  return Promise.resolve(accounts);
}

async function authorizeToken() {
  const token = await authorizeQuartopubAccessToken();
  if (token) {
    return {
      type: AccountTokenType.Authorized,
      name: token.email!,
      token: token.userToken,
    };
  }
}

function environmentAuthToken() {
  return Deno.env.get(kQuartoPubAuthTokenVar);
}

function accessToken(): AccessToken | undefined {
  return readAccessToken<AccessToken>(kQuartopub);
}

async function authorizeQuartopubAccessToken(): Promise<
  AccessToken | undefined
> {
  // create provider
  const client = new QuartopubClient();
  const clientId = (await quartoConfig.dotenv())["QUARTOPUB_APP_CLIENT_ID"];
  const provider: AuthorizationHandler<AccessToken, Ticket> = {
    name: kQuartopub,
    createTicket: function (): Promise<Ticket> {
      return client.createTicket(clientId);
    },
    authorizationUrl: function (ticket: Ticket): string {
      return ticket.authorizationURL;
    },
    checkTicket: function (ticket: Ticket): Promise<Ticket> {
      return client.showTicket(ticket.id);
    },
    exchangeTicket: function (ticket: Ticket): Promise<AccessToken> {
      return client.exchangeTicket(ticket.id);
    },
  };

  return authorizeAccessToken(provider);
}

export function resolveTarget(
  _account: AccountToken,
  target: PublishRecord,
): Promise<PublishRecord> {
  return Promise.resolve(target);
}

function publish(
  _account: AccountToken,
  type: "document" | "site",
  render: (siteUrl: string) => Promise<PublishFiles>,
  target?: PublishRecord,
): Promise<[PublishRecord, URL]> {
  // create client
  // const client = new QuartopubClient();

  const handler: PublishHandler = {
    name: kQuartopub,
    createSite: () => {
      return Promise.resolve({});
    },
    createDeploy: (_siteId: string, _files: Record<string, string>) => {
      return Promise.resolve({});
    },
    getDeploy: (_deployId: string) => {
      return Promise.resolve({});
    },
    uploadDeployFile: async (
      _deployId: string,
      _path: string,
      _fileBody: Blob,
    ) => {
      await withRetry(async () => {
        // upload file
      });
    },
  };

  return handlePublish(handler, type, render, target);
}

function isUnauthorized(_err: Error) {
  return false;
}
