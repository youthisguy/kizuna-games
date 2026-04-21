import { NextRequest, NextResponse } from "next/server";
import {
  TransactionBuilder,
  Networks,
  Keypair,
  FeeBumpTransaction,
  Transaction,
} from "@stellar/stellar-sdk";

const SPONSOR_SECRET = process.env.SPONSOR_SECRET_KEY!;
const networkPassphrase = Networks.TESTNET;
const MAX_FEE = "100000"; // max stroops

export async function POST(req: NextRequest) {
  try {
    const { signedInnerXdr } = await req.json();

    if (!signedInnerXdr) {
      return NextResponse.json(
        { error: "signedInnerXdr required" },
        { status: 400 }
      );
    }

    const sponsorKeypair = Keypair.fromSecret(SPONSOR_SECRET);

    const innerTx = TransactionBuilder.fromXDR(
      signedInnerXdr,
      networkPassphrase
    ) as Transaction;

    // sponsor pays the fee
    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      sponsorKeypair,
      MAX_FEE,
      innerTx,
      networkPassphrase
    );

    feeBumpTx.sign(sponsorKeypair);

    return NextResponse.json({
      feeBumpXdr: feeBumpTx.toXDR(),
    });
  } catch (err: any) {
    console.error("[fee-bump]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
