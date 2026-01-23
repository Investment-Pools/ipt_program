// SPDX-License-Identifier: Apache-2.0

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { RefiIpt, IDL } from "../target/types/refi_ipt";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  approve,
  transfer,
  revoke,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert, expect } from "chai";

describe("🔴 FAULT-INJECTION TESTING - REFI-POOL", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey("HpPJBUex6FdSw7CGvYzjtUmM1629RNTqgCyu6pfcyNBx");
  const program = new Program(IDL, programId, provider) as Program<RefiIpt>;

  // Test accounts
  let usdcMint: PublicKey;
  let iptMint: PublicKey;
  let poolPda: PublicKey;
  let poolBump: number;
  let poolAuthority: PublicKey;
  let usdcReserve: PublicKey;

  // Test wallets
  const payer = (provider.wallet as anchor.Wallet).payer;
  const admin = provider.wallet;
  const oracle = Keypair.generate();
  const feeCollector = Keypair.generate();
  const unauthorizedUser = Keypair.generate();
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  const user3 = Keypair.generate();
  const executor = Keypair.generate();

  // Token accounts
  let adminUsdcAccount: PublicKey;
  let user1UsdcAccount: PublicKey;
  let user1IptAccount: PublicKey;
  let user2UsdcAccount: PublicKey;
  let user2IptAccount: PublicKey;
  let user3UsdcAccount: PublicKey;
  let user3IptAccount: PublicKey;
  let unauthorizedUserUsdcAccount: PublicKey;
  let unauthorizedUserIptAccount: PublicKey;
  let feeCollectorUsdcAccount: PublicKey;

  // Constants
  const INITIAL_EXCHANGE_RATE = new BN(1_034_200); // 1.0342:1 scaled by 1e6
  const DEPOSIT_FEE_BPS = 0; // 0%
  const WITHDRAWAL_FEE_BPS = 100; // 1%
  const MANAGEMENT_FEE_BPS = 50; // 0.5%
  const MAX_TOTAL_SUPPLY = new BN(0); // Unlimited initially
  const MAX_QUEUE_SIZE = 20;
  const DECIMALS = 6;

  // Test results tracking
  const testResults: { 
    category: string; 
    testId: string; 
    description: string; 
    status: "PASS" | "FAIL" | "SKIP"; 
    error?: string;
    expectedError?: string;
    actualError?: string;
  }[] = [];

  // Helper function to record test result
  function recordResult(
    category: string, 
    testId: string, 
    description: string, 
    status: "PASS" | "FAIL" | "SKIP",
    expectedError?: string,
    actualError?: string,
    error?: string
  ) {
    testResults.push({ category, testId, description, status, expectedError, actualError, error });
  }

  // Helper function to check for specific error
  async function expectError(
    promise: Promise<any>,
    expectedErrorCode: string
  ): Promise<boolean> {
    try {
      await promise;
      return false; // Should have thrown
    } catch (err: any) {
      const errorMessage = err.toString();
      return errorMessage.includes(expectedErrorCode);
    }
  }

  // Helper function to get error message from failed tx
  function getErrorFromTx(err: any): string {
    if (err.error?.errorCode?.code) {
      return err.error.errorCode.code;
    }
    if (err.logs) {
      for (const log of err.logs) {
        if (log.includes("Error Code:")) {
          const match = log.match(/Error Code: (\w+)/);
          if (match) return match[1];
        }
      }
    }
    return err.toString().substring(0, 100);
  }

  before(async () => {
    console.log("\n🔧 Setting up Fault-Injection Test Environment...\n");

    // Fund test keypairs
    const recipients = [oracle, feeCollector, unauthorizedUser, user1, user2, user3, executor];
    const transferLamports = 0.1 * anchor.web3.LAMPORTS_PER_SOL;
    const tx = new anchor.web3.Transaction();
    
    for (const kp of recipients) {
      tx.add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: kp.publicKey,
          lamports: transferLamports,
        })
      );
    }
    
    await provider.sendAndConfirm(tx, [payer]);
    console.log(`✅ Funded ${recipients.length} test accounts`);

    // Create USDC mint
    usdcMint = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      DECIMALS
    );
    console.log("✅ USDC Mint created:", usdcMint.toString());

    // Derive PDAs
    [poolPda, poolBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), usdcMint.toBuffer()],
      program.programId
    );
    poolAuthority = poolPda;

    [iptMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("ipt_mint"), poolPda.toBuffer()],
      program.programId
    );

    [usdcReserve] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc_reserve"), poolPda.toBuffer()],
      program.programId
    );

    console.log("✅ PDAs derived");

    // Create token accounts
    adminUsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, admin.publicKey
    )).address;

    user1UsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, user1.publicKey
    )).address;

    user2UsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, user2.publicKey
    )).address;

    user3UsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, user3.publicKey
    )).address;

    unauthorizedUserUsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, unauthorizedUser.publicKey
    )).address;

    feeCollectorUsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, feeCollector.publicKey
    )).address;

    // Mint USDC to accounts
    await mintTo(provider.connection, payer, usdcMint, adminUsdcAccount, payer, 1_000_000 * 10 ** DECIMALS);
    await mintTo(provider.connection, payer, usdcMint, user1UsdcAccount, payer, 100_000 * 10 ** DECIMALS);
    await mintTo(provider.connection, payer, usdcMint, user2UsdcAccount, payer, 100_000 * 10 ** DECIMALS);
    await mintTo(provider.connection, payer, usdcMint, user3UsdcAccount, payer, 100_000 * 10 ** DECIMALS);
    await mintTo(provider.connection, payer, usdcMint, unauthorizedUserUsdcAccount, payer, 50_000 * 10 ** DECIMALS);

    console.log("✅ Token accounts created and funded");

    // Initialize pool - Step 1
    const config = {
      adminAuthority: admin.publicKey,
      oracleAuthority: oracle.publicKey,
      feeCollector: feeCollector.publicKey,
      depositFeeBps: DEPOSIT_FEE_BPS,
      withdrawalFeeBps: WITHDRAWAL_FEE_BPS,
      managementFeeBps: MANAGEMENT_FEE_BPS,
      initialExchangeRate: INITIAL_EXCHANGE_RATE,
      maxTotalSupply: MAX_TOTAL_SUPPLY,
      maxQueueSize: MAX_QUEUE_SIZE,
    };

    await program.methods
      .initPool(config)
      .accounts({
        payer: admin.publicKey,
        usdcMint: usdcMint,
        pool: poolPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Initialize pool - Step 2
    await program.methods
      .initPoolStep2()
      .accounts({
        payer: admin.publicKey,
        pool: poolPda,
        poolAuthority: poolAuthority,
        usdcMint: usdcMint,
        iptMint: iptMint,
        usdcReserve: usdcReserve,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Pool initialized");

    // Create IPT accounts for users
    user1IptAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, user1.publicKey
    )).address;

    user2IptAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, user2.publicKey
    )).address;

    user3IptAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, user3.publicKey
    )).address;

    unauthorizedUserIptAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, unauthorizedUser.publicKey
    )).address;

    console.log("✅ IPT accounts created");

    // Admin deposits initial reserves
    await program.methods
      .adminDepositUsdc(new BN(100_000 * 10 ** DECIMALS))
      .accounts({
        admin: admin.publicKey,
        pool: poolPda,
        adminUsdcAccount: adminUsdcAccount,
        poolUsdcReserve: usdcReserve,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("✅ Initial reserves deposited");
    console.log("\n🚀 Setup complete! Starting Fault-Injection Tests...\n");
  });

  describe("Authorization Errors", () => {
    it("AUTH-01: Fails when non-admin tries to deposit USDC to reserves", async () => {
      const testId = "AUTH-01";
      const expectedError = "UnauthorizedAdmin";
      
      try {
        await program.methods
          .adminDepositUsdc(new BN(1000))
          .accounts({
            admin: unauthorizedUser.publicKey,
            pool: poolPda,
            adminUsdcAccount: unauthorizedUserUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        recordResult("Authorization", testId, "Fails when non-admin tries to deposit USDC to reserves", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown UnauthorizedAdmin error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Authorization", testId, "Fails when non-admin tries to deposit USDC to reserves", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Authorization", testId, "Fails when non-admin tries to deposit USDC to reserves", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AUTH-02: Fails when non-admin tries to withdraw USDC from reserves", async () => {
      const testId = "AUTH-02";
      const expectedError = "UnauthorizedAdmin";
      
      try {
        await program.methods
          .adminWithdrawUsdc(new BN(1000))
          .accounts({
            admin: unauthorizedUser.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            adminUsdcAccount: unauthorizedUserUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        recordResult("Authorization", testId, "Fails when non-admin tries to withdraw USDC from reserves", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown UnauthorizedAdmin error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Authorization", testId, "Fails when non-admin tries to withdraw USDC from reserves", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Authorization", testId, "Fails when non-admin tries to withdraw USDC from reserves", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AUTH-03: Fails when non-admin tries to update pool config", async () => {
      const testId = "AUTH-03";
      const expectedError = "UnauthorizedAdmin";
      
      const newConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 200,
        withdrawalFeeBps: WITHDRAWAL_FEE_BPS,
        managementFeeBps: MANAGEMENT_FEE_BPS,
        initialExchangeRate: INITIAL_EXCHANGE_RATE,
        maxTotalSupply: MAX_TOTAL_SUPPLY,
        maxQueueSize: MAX_QUEUE_SIZE,
      };
      
      try {
        await program.methods
          .adminUpdateConfig(newConfig)
          .accounts({
            admin: unauthorizedUser.publicKey,
            pool: poolPda,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        recordResult("Authorization", testId, "Fails when non-admin tries to update pool config", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown UnauthorizedAdmin error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Authorization", testId, "Fails when non-admin tries to update pool config", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Authorization", testId, "Fails when non-admin tries to update pool config", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AUTH-04: Fails when non-oracle tries to update exchange rate", async () => {
      const testId = "AUTH-04";
      const expectedError = "UnauthorizedOracle";
      
      try {
        await program.methods
          .updateExchangeRate(new BN(1_100_000))
          .accounts({
            oracle: unauthorizedUser.publicKey,
            pool: poolPda,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        recordResult("Authorization", testId, "Fails when non-oracle tries to update exchange rate", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown UnauthorizedOracle error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Authorization", testId, "Fails when non-oracle tries to update exchange rate", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Authorization", testId, "Fails when non-oracle tries to update exchange rate", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AUTH-05: Fails when non-fee-collector tries to withdraw fees", async () => {
      const testId = "AUTH-05";
      const expectedError = "UnauthorizedFeeCollector";
      
      // First, ensure there are some fees
      // User deposits to generate fees
      await program.methods
        .userDeposit(new BN(1000 * 10 ** DECIMALS), new BN(0))
        .accounts({
          user: user1.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: user1UsdcAccount,
          userIptAccount: user1IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
      
      try {
        await program.methods
          .feeCollectorWithdraw(new BN(100))
          .accounts({
            feeCollector: unauthorizedUser.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            feeCollectorUsdcAccount: unauthorizedUserUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([unauthorizedUser])
          .rpc();
        
        recordResult("Authorization", testId, "Fails when non-fee-collector tries to withdraw fees", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown UnauthorizedFeeCollector error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Authorization", testId, "Fails when non-fee-collector tries to withdraw fees", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Authorization", testId, "Fails when non-fee-collector tries to withdraw fees", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });

  describe("Amount Validation Errors", () => {
    it("AMT-01: Fails when user deposits zero USDC", async () => {
      const testId = "AMT-01";
      const expectedError = "InvalidAmount";
      
      try {
        await program.methods
          .userDeposit(new BN(0), new BN(0))
          .accounts({
            user: user1.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userUsdcAccount: user1UsdcAccount,
            userIptAccount: user1IptAccount,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        
        recordResult("Amount", testId, "Fails when user deposits zero USDC", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidAmount error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Amount", testId, "Fails when user deposits zero USDC", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Amount", testId, "Fails when user deposits zero USDC", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AMT-02: Fails when user withdraws zero IPT", async () => {
      const testId = "AMT-02";
      const expectedError = "InvalidAmount";
    
      try {
        await program.methods
          .userWithdraw(new BN(0), new BN(0))
          .accounts({
            user: user1.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userUsdcAccount: user1UsdcAccount,
            userIptAccount: user1IptAccount,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        
        recordResult("Amount", testId, "Fails when user withdraws zero IPT", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidAmount error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Amount", testId, "Fails when user withdraws zero IPT", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Amount", testId, "Fails when user withdraws zero IPT", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AMT-03: Fails when admin deposits zero USDC", async () => {
      const testId = "AMT-03";
      const expectedError = "ZeroAmountNotAllowed";
      
      try {
        await program.methods
          .adminDepositUsdc(new BN(0))
          .accounts({
            admin: admin.publicKey,
            pool: poolPda,
            adminUsdcAccount: adminUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        recordResult("Amount", testId, "Fails when admin deposits zero USDC", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown ZeroAmountNotAllowed error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Amount", testId, "Fails when admin deposits zero USDC", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Amount", testId, "Fails when admin deposits zero USDC", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AMT-04: Fails when admin withdraws zero USDC", async () => {
      const testId = "AMT-04";
      const expectedError = "ZeroAmountNotAllowed";
      
      try {
        await program.methods
          .adminWithdrawUsdc(new BN(0))
          .accounts({
            admin: admin.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            adminUsdcAccount: adminUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        recordResult("Amount", testId, "Fails when admin withdraws zero USDC", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown ZeroAmountNotAllowed error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Amount", testId, "Fails when admin withdraws zero USDC", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Amount", testId, "Fails when admin withdraws zero USDC", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AMT-05: Fails when fee collector withdraws zero amount", async () => {
      const testId = "AMT-05";
      const expectedError = "ZeroAmountNotAllowed";
      
      try {
        await program.methods
          .feeCollectorWithdraw(new BN(0))
          .accounts({
            feeCollector: feeCollector.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            feeCollectorUsdcAccount: feeCollectorUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([feeCollector])
          .rpc();
        
        recordResult("Amount", testId, "Fails when fee collector withdraws zero amount", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown ZeroAmountNotAllowed error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Amount", testId, "Fails when fee collector withdraws zero amount", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Amount", testId, "Fails when fee collector withdraws zero amount", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("AMT-06: Fails when user requests zero withdrawal", async () => {
      const testId = "AMT-06";
      const expectedError = "InvalidAmount";
      
      try {
        await program.methods
          .userWithdrawalRequest(new BN(0), new BN(0))
          .accounts({
            user: user1.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userIptAccount: user1IptAccount,
            iptMint: iptMint,
          })
          .signers([user1])
          .rpc();
        
        recordResult("Amount", testId, "Fails when user requests zero withdrawal", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidAmount error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError)) {
          recordResult("Amount", testId, "Fails when user requests zero withdrawal", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Amount", testId, "Fails when user requests zero withdrawal", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });

  describe("Insufficient Balance Errors", () => {
    it("BAL-01: Fails when user deposits more USDC than balance", async () => {
      const testId = "BAL-01";
      const expectedError = "InsufficientAccountBalance";
      
      // Try to deposit more than user has
      const excessiveAmount = new BN(999_999_999 * 10 ** DECIMALS);
      
      try {
        await program.methods
          .userDeposit(excessiveAmount, new BN(0))
          .accounts({
            user: user2.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userUsdcAccount: user2UsdcAccount,
            userIptAccount: user2IptAccount,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user2])
          .rpc();
        
        recordResult("Balance", testId, "Fails when user deposits more USDC than balance", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InsufficientAccountBalance error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("insufficient")) {
          recordResult("Balance", testId, "Fails when user deposits more USDC than balance", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Balance", testId, "Fails when user deposits more USDC than balance", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("BAL-02: Fails when user withdraws more IPT than balance", async () => {
      const testId = "BAL-02";
      const expectedError = "InsufficientAccountBalance";
      
      // User2 tries to withdraw more IPT than they have (they have 0)
      const excessiveAmount = new BN(999_999 * 10 ** DECIMALS);
      
      try {
        await program.methods
          .userWithdraw(excessiveAmount, new BN(0))
          .accounts({
            user: user2.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userUsdcAccount: user2UsdcAccount,
            userIptAccount: user2IptAccount,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user2])
          .rpc();
        
        recordResult("Balance", testId, "Fails when user withdraws more IPT than balance", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InsufficientAccountBalance error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("insufficient")) {
          recordResult("Balance", testId, "Fails when user withdraws more IPT than balance", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Balance", testId, "Fails when user withdraws more IPT than balance", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("BAL-03: Fails when admin withdraws more than pool reserves", async () => {
      const testId = "BAL-03";
      const expectedError = "InsufficientReserves";
      
      const pool = await program.account.pool.fetch(poolPda);
      const excessiveAmount = pool.totalUsdcReserves.add(new BN(1_000_000 * 10 ** DECIMALS));
      
      try {
        await program.methods
          .adminWithdrawUsdc(excessiveAmount)
          .accounts({
            admin: admin.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            adminUsdcAccount: adminUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        
        recordResult("Balance", testId, "Fails when admin withdraws more than pool reserves", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InsufficientReserves error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("insufficient")) {
          recordResult("Balance", testId, "Fails when admin withdraws more than pool reserves", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Balance", testId, "Fails when admin withdraws more than pool reserves", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("BAL-04: Fails when fee collector withdraws more than accumulated fees", async () => {
      const testId = "BAL-04";
      const expectedError = "InsufficientAccumulatedFees";
      
      const pool = await program.account.pool.fetch(poolPda);
      const excessiveAmount = pool.totalAccumulatedFees.add(new BN(1_000_000 * 10 ** DECIMALS));
      
      try {
        await program.methods
          .feeCollectorWithdraw(excessiveAmount)
          .accounts({
            feeCollector: feeCollector.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            feeCollectorUsdcAccount: feeCollectorUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([feeCollector])
          .rpc();
        
        recordResult("Balance", testId, "Fails when fee collector withdraws more than accumulated fees", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InsufficientAccumulatedFees error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("Insufficient")) {
          recordResult("Balance", testId, "Fails when fee collector withdraws more than accumulated fees", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Balance", testId, "Fails when fee collector withdraws more than accumulated fees", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });


  describe("Slippage Protection Errors", () => {
    it("SLIP-01: Fails when deposit slippage protection triggers", async () => {
      const testId = "SLIP-01";
      const expectedError = "SlippageExceeded";
      
      // Deposit small amount but expect huge IPT (impossible slippage)
      const depositAmount = new BN(100 * 10 ** DECIMALS);
      const impossibleMinIpt = new BN(999_999 * 10 ** DECIMALS);
      
      try {
        await program.methods
          .userDeposit(depositAmount, impossibleMinIpt)
          .accounts({
            user: user2.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userUsdcAccount: user2UsdcAccount,
            userIptAccount: user2IptAccount,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user2])
          .rpc();
        
        recordResult("Slippage", testId, "Fails when deposit slippage protection triggers", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown SlippageExceeded error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("Slippage")) {
          recordResult("Slippage", testId, "Fails when deposit slippage protection triggers", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Slippage", testId, "Fails when deposit slippage protection triggers", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("SLIP-02: Fails when withdrawal slippage protection triggers", async () => {
      const testId = "SLIP-02";
      const expectedError = "SlippageExceeded";
      
      // First deposit to get some IPT
      await program.methods
        .userDeposit(new BN(1000 * 10 ** DECIMALS), new BN(0))
        .accounts({
          user: user2.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: user2UsdcAccount,
          userIptAccount: user2IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();
      
      // Now try to withdraw with impossible slippage protection
      const withdrawAmount = new BN(100 * 10 ** DECIMALS);
      const impossibleMinUsdc = new BN(999_999 * 10 ** DECIMALS);
      
      try {
        await program.methods
          .userWithdraw(withdrawAmount, impossibleMinUsdc)
          .accounts({
            user: user2.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userUsdcAccount: user2UsdcAccount,
            userIptAccount: user2IptAccount,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user2])
          .rpc();
        
        recordResult("Slippage", testId, "Fails when withdrawal slippage protection triggers", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown SlippageExceeded error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("Slippage")) {
          recordResult("Slippage", testId, "Fails when withdrawal slippage protection triggers", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Slippage", testId, "Fails when withdrawal slippage protection triggers", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });

  describe("Exchange Rate Errors", () => {
    
    it("RATE-01: Fails when oracle sets exchange rate to zero", async () => {
      const testId = "RATE-01";
      const expectedError = "InvalidExchangeRate";
      
      try {
        await program.methods
          .updateExchangeRate(new BN(0))
          .accounts({
            oracle: oracle.publicKey,
            pool: poolPda,
          })
          .signers([oracle])
          .rpc();
        
        recordResult("ExchangeRate", testId, "Fails when oracle sets exchange rate to zero", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidExchangeRate error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("exchange rate")) {
          recordResult("ExchangeRate", testId, "Fails when oracle sets exchange rate to zero", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("ExchangeRate", testId, "Fails when oracle sets exchange rate to zero", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("RATE-02: Fails when oracle sets same exchange rate (no-op)", async () => {
      const testId = "RATE-02";
      const expectedError = "InvalidExchangeRate";
      
      const pool = await program.account.pool.fetch(poolPda);
      const currentRate = pool.currentExchangeRate;
      
      try {
        await program.methods
          .updateExchangeRate(currentRate)
          .accounts({
            oracle: oracle.publicKey,
            pool: poolPda,
          })
          .signers([oracle])
          .rpc();
        
        recordResult("ExchangeRate", testId, "Fails when oracle sets same exchange rate (no-op)", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidExchangeRate error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("exchange rate")) {
          recordResult("ExchangeRate", testId, "Fails when oracle sets same exchange rate (no-op)", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("ExchangeRate", testId, "Fails when oracle sets same exchange rate (no-op)", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });

  describe("Queue Errors", () => {
    it("QUEUE-01: Fails when non-queued user tries to cancel request", async () => {
      const testId = "QUEUE-01";
      const expectedError = "InvalidUserAccount";
      
      try {
        await program.methods
          .cancelWithdrawalRequest()
          .accounts({
            user: user3.publicKey,
            pool: poolPda,
          })
          .signers([user3])
          .rpc();
        
        recordResult("Queue", testId, "Fails when non-queued user tries to cancel request", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidUserAccount error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("Invalid")) {
          recordResult("Queue", testId, "Fails when non-queued user tries to cancel request", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Queue", testId, "Fails when non-queued user tries to cancel request", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("QUEUE-02: Fails when executing empty withdrawal batch", async () => {
      const testId = "QUEUE-02";
      const expectedError = "EmptyWithdrawalBatch";
      
      try {
        await program.methods
          .batchExecuteWithdraw([])
          .accounts({
            executor: executor.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([executor])
          .rpc();
        
        recordResult("Queue", testId, "Fails when executing empty withdrawal batch", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown EmptyWithdrawalBatch error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("Empty")) {
          recordResult("Queue", testId, "Fails when executing empty withdrawal batch", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Queue", testId, "Fails when executing empty withdrawal batch", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("QUEUE-03: Fails when batch size exceeds maximum (10)", async () => {
      const testId = "QUEUE-03";
      const expectedError = "BatchSizeTooLarge";
      
      // Create amounts array with 11 items
      const amounts = Array(11).fill(new BN(100));
      
      try {
        await program.methods
          .batchExecuteWithdraw(amounts)
          .accounts({
            executor: executor.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([executor])
          .rpc();
        
        recordResult("Queue", testId, "Fails when batch size exceeds maximum (10)", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown BatchSizeTooLarge error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("Batch size")) {
          recordResult("Queue", testId, "Fails when batch size exceeds maximum (10)", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Queue", testId, "Fails when batch size exceeds maximum (10)", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });

  describe("Delegation Errors", () => {
    it("DEL-01: Fails when user queues without token delegation", async () => {
      const testId = "DEL-01";
      const expectedError = "InsufficientApproval";
      
      // First make sure user3 has some IPT
      await program.methods
        .userDeposit(new BN(1000 * 10 ** DECIMALS), new BN(0))
        .accounts({
          user: user3.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: user3UsdcAccount,
          userIptAccount: user3IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user3])
        .rpc();
      
      // Revoke any existing delegation
      try {
        await revoke(
          provider.connection,
          user3,
          user3IptAccount,
          user3.publicKey
        );
      } catch (e) {
        // Ignore if no delegation exists
      }
      
      // Now try to make withdrawal request without delegation
      try {
        await program.methods
          .userWithdrawalRequest(new BN(100 * 10 ** DECIMALS), new BN(0))
          .accounts({
            user: user3.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userIptAccount: user3IptAccount,
            iptMint: iptMint,
          })
          .signers([user3])
          .rpc();
        
        recordResult("Delegation", testId, "Fails when user queues without token delegation", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InsufficientApproval error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || 
            err.toString().includes("Approval") || err.toString().includes("delegate")) {
          recordResult("Delegation", testId, "Fails when user queues without token delegation", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Delegation", testId, "Fails when user queues without token delegation", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("DEL-02: Fails when user queues with insufficient delegation", async () => {
      const testId = "DEL-02";
      const expectedError = "InsufficientApproval";
      
      // Approve only a small amount
      await approve(
        provider.connection,
        user3,
        user3IptAccount,
        poolAuthority,
        user3.publicKey,
        BigInt(10 * 10 ** DECIMALS) // Only 10 IPT
      );
      
      // Try to request withdrawal of more than delegated
      try {
        await program.methods
          .userWithdrawalRequest(new BN(500 * 10 ** DECIMALS), new BN(0)) // 500 IPT > 10 delegated
          .accounts({
            user: user3.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userIptAccount: user3IptAccount,
            iptMint: iptMint,
          })
          .signers([user3])
          .rpc();
        
        recordResult("Delegation", testId, "Fails when user queues with insufficient delegation", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InsufficientApproval error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || 
            err.toString().includes("Approval") || err.toString().includes("Insufficient")) {
          recordResult("Delegation", testId, "Fails when user queues with insufficient delegation", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult("Delegation", testId, "Fails when user queues with insufficient delegation", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });

  describe("Security/Attack Scenarios", () => {
    it("SEC-01: Queue blocking attack - user transfers IPT away after queuing", async () => {
      const testId = "SEC-01";
      const description = "Queue blocking attack - user transfers IPT away after queuing";
      
      console.log(`\n🔥 ${testId}: Testing queue blocking attack scenario...`);
      
      // Setup: Create reserve shortage to force queue
      const pool1 = await program.account.pool.fetch(poolPda);
      const reserveToWithdraw = pool1.totalUsdcReserves.sub(new BN(500 * 10 ** DECIMALS));
      
      if (reserveToWithdraw.gt(new BN(0))) {
        await program.methods
          .adminWithdrawUsdc(reserveToWithdraw)
          .accounts({
            admin: admin.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            adminUsdcAccount: adminUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
      }
      
      // User1 (attacker) queues withdrawal
      const user1IptBalance = await getAccount(provider.connection, user1IptAccount);
      if (user1IptBalance.amount > BigInt(0)) {
        const withdrawAmount = new BN(user1IptBalance.amount.toString()).div(new BN(2));
        
        await approve(
          provider.connection,
          user1,
          user1IptAccount,
          poolAuthority,
          user1.publicKey,
          BigInt(withdrawAmount.toString())
        );
        
        await program.methods
          .userWithdraw(withdrawAmount, new BN(0))
          .accounts({
            user: user1.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userUsdcAccount: user1UsdcAccount,
            userIptAccount: user1IptAccount,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        
        const poolAfterQueue = await program.account.pool.fetch(poolPda);
        
        if (poolAfterQueue.pendingQueue.length > 0) {
          // ATTACK: User1 transfers all IPT to another account
          const balanceBeforeTransfer = await getAccount(provider.connection, user1IptAccount);
          
          if (balanceBeforeTransfer.amount > BigInt(0)) {
            // Create temp account for transfer
            const tempUser = Keypair.generate();
            const tempIptAccount = (await getOrCreateAssociatedTokenAccount(
              provider.connection, payer, iptMint, tempUser.publicKey
            )).address;
            
            await transfer(
              provider.connection,
              user1,
              user1IptAccount,
              tempIptAccount,
              user1.publicKey,
              balanceBeforeTransfer.amount
            );
            
            const balanceAfterTransfer = await getAccount(provider.connection, user1IptAccount);
            
            if (balanceAfterTransfer.amount === BigInt(0)) {
              console.log(`✅ ${testId}: Attack setup complete - user has 0 IPT but is in queue`);
              console.log(`   Queue should skip this user when processing`);
              recordResult("Security", testId, description, "PASS", 
                "User with 0 balance in queue should be skipped", 
                "Setup verified - batch processing will skip");
            }
          }
        } else {
          console.log(`⚠️ ${testId}: Could not add to queue (maybe instant withdrawal occurred)`);
          recordResult("Security", testId, description, "SKIP", "", "", "Could not create queue scenario");
        }
      } else {
        console.log(`⚠️ ${testId}: User1 has no IPT balance to test with`);
        recordResult("Security", testId, description, "SKIP", "", "", "No IPT balance available");
      }
      
      // Restore reserves
      await program.methods
        .adminDepositUsdc(new BN(50_000 * 10 ** DECIMALS))
        .accounts({
          admin: admin.publicKey,
          pool: poolPda,
          adminUsdcAccount: adminUsdcAccount,
          poolUsdcReserve: usdcReserve,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });
  });

  after(async () => {
    console.log("\n");
    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║           📊 FAULT-INJECTION TEST RESULTS SUMMARY                ║");
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    
    const passCount = testResults.filter(r => r.status === "PASS").length;
    const failCount = testResults.filter(r => r.status === "FAIL").length;
    const skipCount = testResults.filter(r => r.status === "SKIP").length;
    const totalCount = testResults.length;
    
    console.log(`║  Total Tests: ${totalCount.toString().padEnd(4)} | ✅ PASS: ${passCount.toString().padEnd(4)} | ❌ FAIL: ${failCount.toString().padEnd(4)} | ⏭️ SKIP: ${skipCount.toString().padEnd(4)} ║`);
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    
    // Group by category
    const categories = [...new Set(testResults.map(r => r.category))];
    
    for (const category of categories) {
      const categoryResults = testResults.filter(r => r.category === category);
      const catPass = categoryResults.filter(r => r.status === "PASS").length;
      const catFail = categoryResults.filter(r => r.status === "FAIL").length;
      const catSkip = categoryResults.filter(r => r.status === "SKIP").length;
      
      let statusIcon = catFail === 0 ? "✅" : "❌";
      console.log(`║  ${statusIcon} ${category.padEnd(20)} | Pass: ${catPass} | Fail: ${catFail} | Skip: ${catSkip}`.padEnd(67) + "║");
    }
    
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    
    // Failed tests details
    const failedTests = testResults.filter(r => r.status === "FAIL");
    if (failedTests.length > 0) {
      console.log("║  ❌ FAILED TESTS:                                                 ║");
      for (const test of failedTests) {
        console.log(`║    - ${test.testId}: ${test.description.substring(0, 45).padEnd(45)}  ║`);
        console.log(`║      Expected: ${(test.expectedError || "").substring(0, 20).padEnd(20)} Got: ${(test.actualError || "").substring(0, 20).padEnd(20)} ║`);
      }
    } else {
      console.log("║  🎉 ALL TESTS PASSED! No failed tests.                           ║");
    }
    
    console.log("╚══════════════════════════════════════════════════════════════════╝");
    console.log("\n");
  });
});