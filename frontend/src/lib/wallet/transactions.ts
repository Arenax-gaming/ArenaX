import freighterApi from "@stellar/freighter-api";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { getAlbedoClient } from "@/lib/wallet/connectors";
import { walletConfig } from "@/lib/wallet/config";
import {
  TxKind,
  TxPhase,
  WalletAssetCode,
  WalletSession,
} from "@/lib/wallet/types";

interface SubmitWithdrawParams {
  wallet: WalletSession;
  asset: WalletAssetCode;
  amount: number;
  destination: string;
  memo?: string;
  onPhaseChange?: (phase: TxPhase) => void;
}

interface SubmitTxResult {
  hash: string;
  kind: TxKind;
}

const MAX_MEMO_LENGTH = 28;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeAmount = (amount: number) => {
  const fixed = amount.toFixed(7);
  const normalized = fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return normalized || "0";
};

const buildTxError = (message: string): Error => {
  return new Error(message);
};

const createClassicAsset = (asset: WalletAssetCode) => {
  if (asset === "XLM") {
    return Asset.native();
  }

  const config = walletConfig.assets[asset];

  if (config.source === "soroban") {
    throw buildTxError(
      `${asset} is configured as a Soroban contract token in this environment.`,
    );
  }

  if (!config.issuer) {
    throw buildTxError(`${asset} issuer is not configured.`);
  }

  return new Asset(asset, config.issuer);
};

const readFreighterMessage = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return "Freighter rejected the request.";
  }

  const payload = error as { message?: string };
  return payload.message || "Freighter rejected the request.";
};

const signWithFreighter = async (
  wallet: WalletSession,
  unsignedXdr: string,
): Promise<string> => {
  const result = await freighterApi.signTransaction(unsignedXdr, {
    address: wallet.publicKey,
    networkPassphrase: walletConfig.networkPassphrase,
  });

  if (result.error || !result.signedTxXdr) {
    throw buildTxError(readFreighterMessage(result.error));
  }

  return result.signedTxXdr;
};

const signWithAlbedo = async (
  wallet: WalletSession,
  unsignedXdr: string,
): Promise<string> => {
  const albedo = await getAlbedoClient();
  const result = await albedo.tx({
    xdr: unsignedXdr,
    network: wallet.network === "mainnet" ? "public" : "testnet",
    pubkey: wallet.publicKey,
    submit: false,
    description: "ArenaX wallet withdrawal",
  });

  if (!result.signed_envelope_xdr) {
    throw buildTxError("Albedo did not return a signed transaction.");
  }

  return result.signed_envelope_xdr;
};

const submitSignedXdr = async (signedXdr: string): Promise<string> => {
  const server = new Horizon.Server(walletConfig.horizonUrl);
  const envelope = TransactionBuilder.fromXDR(
    signedXdr,
    walletConfig.networkPassphrase,
  );

  const response = await server.submitTransaction(envelope);
  const hash = (response as { hash?: string }).hash;

  if (!hash) {
    throw buildTxError("Unable to determine submitted transaction hash.");
  }

  return hash;
};

const submitClassicWithdraw = async ({
  wallet,
  asset,
  amount,
  destination,
  memo,
  onPhaseChange,
}: SubmitWithdrawParams): Promise<SubmitTxResult> => {
  const server = new Horizon.Server(walletConfig.horizonUrl);

  onPhaseChange?.("signing");

  const sourceAccount = await server.loadAccount(wallet.publicKey);
  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: walletConfig.networkPassphrase,
  });

  txBuilder.addOperation(
    Operation.payment({
      destination,
      amount: normalizeAmount(amount),
      asset: createClassicAsset(asset),
    }),
  );

  if (memo) {
    txBuilder.addMemo(Memo.text(memo.slice(0, MAX_MEMO_LENGTH)));
  }

  const builtTx = txBuilder.setTimeout(120).build();

  const signedXdr =
    wallet.walletType === "freighter"
      ? await signWithFreighter(wallet, builtTx.toXDR())
      : await signWithAlbedo(wallet, builtTx.toXDR());

  onPhaseChange?.("submitted");

  const hash = await submitSignedXdr(signedXdr);

  return {
    hash,
    kind: "classic",
  };
};

const submitSorobanWithdraw = async ({
  onPhaseChange,
}: SubmitWithdrawParams): Promise<SubmitTxResult> => {
  onPhaseChange?.("signing");

  throw buildTxError(
    "Soroban transfer flow is not configured for this ArenaX deployment.",
  );
};

export const submitWithdrawTransaction = async (
  params: SubmitWithdrawParams,
): Promise<SubmitTxResult> => {
  const config = walletConfig.assets[params.asset];

  if (config.source === "soroban") {
    return submitSorobanWithdraw(params);
  }

  return submitClassicWithdraw(params);
};

const parseHorizonFailure = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "Transaction failed on Stellar network.";
  }

  const response = payload as Record<string, unknown>;
  const title = typeof response.title === "string" ? response.title : "";
  const extras =
    response.extras && typeof response.extras === "object"
      ? (response.extras as Record<string, unknown>)
      : undefined;

  const resultCodes =
    extras?.result_codes && typeof extras.result_codes === "object"
      ? (extras.result_codes as Record<string, unknown>)
      : undefined;

  if (resultCodes?.operations && Array.isArray(resultCodes.operations)) {
    const opCode = String(resultCodes.operations[0] ?? "");

    if (opCode === "op_no_trust") {
      return "Destination account does not trust this asset.";
    }

    if (opCode === "op_underfunded") {
      return "Insufficient balance for this transaction.";
    }

    if (opCode === "op_no_destination") {
      return "Destination account does not exist on Stellar.";
    }

    if (opCode) {
      return `Operation failed: ${opCode}.`;
    }
  }

  if (title) {
    return title;
  }

  return "Transaction failed on Stellar network.";
};

const waitForHorizonConfirmation = async (hash: string) => {
  const txUrl = `${walletConfig.horizonUrl.replace(/\/$/, "")}/transactions/${hash}`;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const response = await fetch(txUrl, { cache: "no-store" });

    if (response.status === 404) {
      await sleep(1500);
      continue;
    }

    if (!response.ok) {
      throw buildTxError("Unable to verify transaction status from Horizon.");
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const successful = payload.successful;

    if (successful === true) {
      return;
    }

    if (successful === false) {
      throw buildTxError(parseHorizonFailure(payload));
    }

    await sleep(1000);
  }

  throw buildTxError("Timed out waiting for Stellar confirmation.");
};

const readSorobanFailureMessage = (result: Record<string, unknown>) => {
  const errorResultXdr =
    typeof result.errorResultXdr === "string" ? result.errorResultXdr : undefined;

  if (errorResultXdr) {
    return "Soroban transaction failed while executing contract call.";
  }

  return "Soroban transaction failed.";
};

const waitForSorobanConfirmation = async (hash: string) => {
  const rpcUrl = walletConfig.sorobanRpcUrl;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${hash}-${attempt}`,
        method: "getTransaction",
        params: {
          hash,
        },
      }),
    });

    if (!response.ok) {
      await sleep(1200);
      continue;
    }

    const payload = (await response.json()) as {
      error?: { message?: string };
      result?: Record<string, unknown>;
    };

    if (payload.error?.message) {
      throw buildTxError(payload.error.message);
    }

    const status = typeof payload.result?.status === "string" ? payload.result.status : "";

    if (status === "SUCCESS") {
      return;
    }

    if (status === "FAILED") {
      throw buildTxError(readSorobanFailureMessage(payload.result ?? {}));
    }

    await sleep(1200);
  }

  throw buildTxError("Timed out waiting for Soroban confirmation.");
};

export const waitForTransactionConfirmation = async (
  hash: string,
  kind: TxKind,
) => {
  if (kind === "soroban") {
    await waitForSorobanConfirmation(hash);
    return;
  }

  await waitForHorizonConfirmation(hash);
};

export const isValidStellarAddress = (value: string) => {
  return StrKey.isValidEd25519PublicKey(value.trim());
};

export const sanitizeTxError = (error: unknown) => {
  if (!error) {
    return "Transaction failed.";
  }

  if (error instanceof Error) {
    const message = error.message.trim();

    if (/denied|rejected|declined/i.test(message)) {
      return "Transaction was rejected in your wallet.";
    }

    if (/op_no_trust/i.test(message)) {
      return "Destination account does not trust the selected asset.";
    }

    if (/op_underfunded|insufficient/i.test(message)) {
      return "Insufficient balance for this transfer.";
    }

    if (/op_no_destination/i.test(message)) {
      return "Destination account does not exist on Stellar.";
    }

    return message || "Transaction failed.";
  }

  if (typeof error === "object") {
    const payload = error as Record<string, unknown>;

    if (typeof payload.message === "string" && payload.message) {
      return payload.message;
    }

    if (payload.response) {
      return parseHorizonFailure(payload.response);
    }
  }

  return "Transaction failed.";
};
