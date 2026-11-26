import { StrategyCoreModule } from '../strategy/strategy.module';
import { Module } from '@nestjs/common';
import { OffersModule } from '../offers/offers.module';
import { BenefitsModule } from '../portfolio/benefits';
import { HouseholdsModule } from '../portfolio/households';
import { PortfolioModule } from '../portfolio/portfolio';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { WalletModule } from '../wallet/wallet.module';
import { AiAdminController, AiAdminService } from './admin-ai.controller';
import { AiController, TokensController, TokensService } from './ai.controller';
import { AiService } from './ai.service';
import { BenefitClassifyService } from './benefit-classify';
import { SpendCoreModule } from '../spend/spend.module';
import { McpClientService } from './mcp-client';
import { McpServerController } from './mcp-server';
import { ModelRouter } from './router';
import { OrchestratorService } from './orchestrator.service';
import { PromptsService } from './prompts.service';
import { PromptsAdminController, WorkflowsController } from './workflows.controller';
import { BenefitAuditModule } from '../benefit-audit/benefit-audit.module';
import { ToolRegistry } from './tools';

/** Core AI providers (no controllers) — shared by the API and the worker. */
@Module({
  imports: [PortfolioModule, BenefitsModule, HouseholdsModule, RecommendationsModule, OffersModule, WalletModule, StrategyCoreModule, SpendCoreModule, BenefitAuditModule],
  providers: [ToolRegistry, ModelRouter, McpClientService, AiService, TokensService, BenefitClassifyService, OrchestratorService, PromptsService],
  exports: [ToolRegistry, ModelRouter, McpClientService, AiService, TokensService, OrchestratorService, PromptsService],
})
export class AiCoreModule {}

@Module({
  imports: [AiCoreModule],
  controllers: [AiController, TokensController, AiAdminController, McpServerController, WorkflowsController, PromptsAdminController],
  providers: [AiAdminService],
})
export class AiModule {}
