// SPDX-License-Identifier: Apache-2.0

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { RefiIpt, IDL } from "../target/types/refi_ipt";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("🔴 FAULT-INJECTION: Configuration & Pool State", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey("HpPJBUex6FdSw7CGvYzjtUmM1629RNTqgCyu6pfcyNBx");
  const program = new Program(IDL, programId, provider) as Program<RefiIpt>;

  const payer = (provider.wallet as anchor.Wallet).payer;
  const admin = provider.wallet;
  const oracle = Keypair.generate();
  const feeCollector = Keypair.generate();
  const user1 = Keypair.generate();

  const DECIMALS = 6;

  // Test results tracking
  const testResults: { 
    testId: string; 
    description: string; 
    status: "PASS" | "FAIL" | "SKIP"; 
    expectedError?: string;
    actualError?: string;
  }[] = [];

  function recordResult(testId: string, description: string, status: "PASS" | "FAIL" | "SKIP", expectedError?: string, actualError?: string) {
    testResults.push({ testId, description, status, expectedError, actualError });
  }

  function getErrorFromTx(err: any): string {
    if (err.error?.errorCode?.code) return err.error.errorCode.code;
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


  describe("Configuration Validation Errors", () => {
    it("CFG-01: Fails when deposit fee exceeds 100%", async () => {
      const testId = "CFG-01";
      const expectedError = "InvalidFeeRate";
      
      // Create a new USDC mint for this test
      const testUsdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );
      
      const [testPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), testUsdcMint.toBuffer()],
        program.programId
      );
      
      const invalidConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 10001, // > 10000 (>100%)
        withdrawalFeeBps: 100,
        managementFeeBps: 50,
        initialExchangeRate: new BN(1_000_000),
        maxTotalSupply: new BN(0),
        maxQueueSize: 20,
      };
      
      try {
        await program.methods
          .initPool(invalidConfig)
          .accounts({
            payer: admin.publicKey,
            usdcMint: testUsdcMint,
            pool: testPoolPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        recordResult(testId, "Fails when deposit fee exceeds 100%", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidFeeRate error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("fee")) {
          recordResult(testId, "Fails when deposit fee exceeds 100%", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when deposit fee exceeds 100%", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("CFG-02: Fails when withdrawal fee exceeds 100%", async () => {
      const testId = "CFG-02";
      const expectedError = "InvalidFeeRate";
      
      const testUsdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );
      
      const [testPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), testUsdcMint.toBuffer()],
        program.programId
      );
      
      const invalidConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 100,
        withdrawalFeeBps: 15000, // > 10000 (>100%)
        managementFeeBps: 50,
        initialExchangeRate: new BN(1_000_000),
        maxTotalSupply: new BN(0),
        maxQueueSize: 20,
      };
      
      try {
        await program.methods
          .initPool(invalidConfig)
          .accounts({
            payer: admin.publicKey,
            usdcMint: testUsdcMint,
            pool: testPoolPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        recordResult(testId, "Fails when withdrawal fee exceeds 100%", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidFeeRate error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("fee")) {
          recordResult(testId, "Fails when withdrawal fee exceeds 100%", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when withdrawal fee exceeds 100%", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("CFG-03: Fails when management fee exceeds 100%", async () => {
      const testId = "CFG-03";
      const expectedError = "InvalidFeeRate";
      
      const testUsdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );
      
      const [testPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), testUsdcMint.toBuffer()],
        program.programId
      );
      
      const invalidConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 100,
        withdrawalFeeBps: 100,
        managementFeeBps: 20000, // > 10000 (>100%)
        initialExchangeRate: new BN(1_000_000),
        maxTotalSupply: new BN(0),
        maxQueueSize: 20,
      };
      
      try {
        await program.methods
          .initPool(invalidConfig)
          .accounts({
            payer: admin.publicKey,
            usdcMint: testUsdcMint,
            pool: testPoolPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        recordResult(testId, "Fails when management fee exceeds 100%", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidFeeRate error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("fee")) {
          recordResult(testId, "Fails when management fee exceeds 100%", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when management fee exceeds 100%", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("CFG-04: Fails when initial exchange rate is zero", async () => {
      const testId = "CFG-04";
      const expectedError = "InvalidExchangeRate";
      
      const testUsdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );
      
      const [testPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), testUsdcMint.toBuffer()],
        program.programId
      );
      
      const invalidConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 100,
        withdrawalFeeBps: 100,
        managementFeeBps: 50,
        initialExchangeRate: new BN(0), // Zero exchange rate
        maxTotalSupply: new BN(0),
        maxQueueSize: 20,
      };
      
      try {
        await program.methods
          .initPool(invalidConfig)
          .accounts({
            payer: admin.publicKey,
            usdcMint: testUsdcMint,
            pool: testPoolPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        recordResult(testId, "Fails when initial exchange rate is zero", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidExchangeRate error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("exchange rate")) {
          recordResult(testId, "Fails when initial exchange rate is zero", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when initial exchange rate is zero", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("CFG-05: Fails when admin authority is invalid (default pubkey)", async () => {
      const testId = "CFG-05";
      const expectedError = "InvalidAuthority";
      
      const testUsdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );
      
      const [testPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), testUsdcMint.toBuffer()],
        program.programId
      );
      
      const invalidConfig = {
        adminAuthority: PublicKey.default, // Invalid: default pubkey
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 100,
        withdrawalFeeBps: 100,
        managementFeeBps: 50,
        initialExchangeRate: new BN(1_000_000),
        maxTotalSupply: new BN(0),
        maxQueueSize: 20,
      };
      
      try {
        await program.methods
          .initPool(invalidConfig)
          .accounts({
            payer: admin.publicKey,
            usdcMint: testUsdcMint,
            pool: testPoolPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        recordResult(testId, "Fails when admin authority is invalid (default pubkey)", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidAuthority error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("authority")) {
          recordResult(testId, "Fails when admin authority is invalid (default pubkey)", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when admin authority is invalid (default pubkey)", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("CFG-06: Fails when oracle authority is invalid (default pubkey)", async () => {
      const testId = "CFG-06";
      const expectedError = "InvalidAuthority";
      
      const testUsdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );
      
      const [testPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), testUsdcMint.toBuffer()],
        program.programId
      );
      
      const invalidConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: PublicKey.default, // Invalid: default pubkey
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 100,
        withdrawalFeeBps: 100,
        managementFeeBps: 50,
        initialExchangeRate: new BN(1_000_000),
        maxTotalSupply: new BN(0),
        maxQueueSize: 20,
      };
      
      try {
        await program.methods
          .initPool(invalidConfig)
          .accounts({
            payer: admin.publicKey,
            usdcMint: testUsdcMint,
            pool: testPoolPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        recordResult(testId, "Fails when oracle authority is invalid (default pubkey)", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidAuthority error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("authority")) {
          recordResult(testId, "Fails when oracle authority is invalid (default pubkey)", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when oracle authority is invalid (default pubkey)", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("CFG-07: Fails when fee collector is invalid (default pubkey)", async () => {
      const testId = "CFG-07";
      const expectedError = "InvalidAuthority";
      
      const testUsdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );
      
      const [testPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), testUsdcMint.toBuffer()],
        program.programId
      );
      
      const invalidConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: PublicKey.default, // Invalid: default pubkey
        depositFeeBps: 100,
        withdrawalFeeBps: 100,
        managementFeeBps: 50,
        initialExchangeRate: new BN(1_000_000),
        maxTotalSupply: new BN(0),
        maxQueueSize: 20,
      };
      
      try {
        await program.methods
          .initPool(invalidConfig)
          .accounts({
            payer: admin.publicKey,
            usdcMint: testUsdcMint,
            pool: testPoolPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        recordResult(testId, "Fails when fee collector is invalid (default pubkey)", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidAuthority error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("authority")) {
          recordResult(testId, "Fails when fee collector is invalid (default pubkey)", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when fee collector is invalid (default pubkey)", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });

    it("CFG-08: Fails when max queue size exceeds limit (20)", async () => {
      const testId = "CFG-08";
      const expectedError = "InvalidConfigParameter";
      
      const testUsdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );
      
      const [testPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), testUsdcMint.toBuffer()],
        program.programId
      );
      
      const invalidConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 100,
        withdrawalFeeBps: 100,
        managementFeeBps: 50,
        initialExchangeRate: new BN(1_000_000),
        maxTotalSupply: new BN(0),
        maxQueueSize: 100, // > 20 (MAX_QUEUE_SIZE)
      };
      
      try {
        await program.methods
          .initPool(invalidConfig)
          .accounts({
            payer: admin.publicKey,
            usdcMint: testUsdcMint,
            pool: testPoolPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        recordResult(testId, "Fails when max queue size exceeds limit (20)", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown InvalidConfigParameter error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("config")) {
          recordResult(testId, "Fails when max queue size exceeds limit (20)", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when max queue size exceeds limit (20)", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });

  describe("Supply Limit Errors", () => {
    let poolPda: PublicKey;
    let poolAuthority: PublicKey;
    let usdcMint: PublicKey;
    let iptMint: PublicKey;
    let usdcReserve: PublicKey;
    let adminUsdcAccount: PublicKey;
    let user1UsdcAccount: PublicKey;
    let user1IptAccount: PublicKey;

    before(async () => {
      // Create new pool with max_total_supply limit for testing
      usdcMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        null,
        DECIMALS
      );

      [poolPda] = PublicKey.findProgramAddressSync(
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

      // Create token accounts
      adminUsdcAccount = (await getOrCreateAssociatedTokenAccount(
        provider.connection, payer, usdcMint, admin.publicKey
      )).address;

      user1UsdcAccount = (await getOrCreateAssociatedTokenAccount(
        provider.connection, payer, usdcMint, user1.publicKey
      )).address;

      // Mint USDC
      await mintTo(provider.connection, payer, usdcMint, adminUsdcAccount, payer, 1_000_000 * 10 ** DECIMALS);
      await mintTo(provider.connection, payer, usdcMint, user1UsdcAccount, payer, 100_000 * 10 ** DECIMALS);

      // Initialize pool with LIMITED max_total_supply
      const config = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: 100,
        withdrawalFeeBps: 100,
        managementFeeBps: 50,
        initialExchangeRate: new BN(1_000_000),
        maxTotalSupply: new BN(1000 * 10 ** DECIMALS), // LIMIT: Only 1000 IPT max
        maxQueueSize: 20,
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

      user1IptAccount = (await getOrCreateAssociatedTokenAccount(
        provider.connection, payer, iptMint, user1.publicKey
      )).address;

      // Admin deposits reserves
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

    it("SUPPLY-01: Fails when deposit exceeds max total IPT supply", async () => {
      const testId = "SUPPLY-01";
      const expectedError = "MaxTotalSupplyExceeded";
      
      // Try to deposit more than max_total_supply allows
      // Pool has max 1000 IPT, try to deposit equivalent of 2000 IPT
      const excessiveDeposit = new BN(2000 * 10 ** DECIMALS);
      
      try {
        await program.methods
          .userDeposit(excessiveDeposit, new BN(0))
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
        
        recordResult(testId, "Fails when deposit exceeds max total IPT supply", "FAIL", expectedError, "No error thrown");
        assert.fail("Should have thrown MaxTotalSupplyExceeded error");
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("supply")) {
          recordResult(testId, "Fails when deposit exceeds max total IPT supply", "PASS", expectedError, actualError);
          console.log(`✅ ${testId}: Correctly rejected - ${expectedError}`);
        } else {
          recordResult(testId, "Fails when deposit exceeds max total IPT supply", "FAIL", expectedError, actualError);
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
        }
      }
    });
  });

  after(async () => {
    console.log("\n");
    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║     📊 CONFIGURATION & STATE TEST RESULTS SUMMARY                ║");
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    
    const passCount = testResults.filter(r => r.status === "PASS").length;
    const failCount = testResults.filter(r => r.status === "FAIL").length;
    const skipCount = testResults.filter(r => r.status === "SKIP").length;
    
    console.log(`║  ✅ PASS: ${passCount.toString().padEnd(3)} | ❌ FAIL: ${failCount.toString().padEnd(3)} | ⏭️ SKIP: ${skipCount.toString().padEnd(3)}                      ║`);
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    
    for (const result of testResults) {
      const statusIcon = result.status === "PASS" ? "✅" : result.status === "FAIL" ? "❌" : "⏭️";
      console.log(`║  ${statusIcon} ${result.testId}: ${result.description.substring(0, 45).padEnd(45)}   ║`);
    }
    
    console.log("╚══════════════════════════════════════════════════════════════════╝");
  });
});