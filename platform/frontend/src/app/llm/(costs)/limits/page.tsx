"use client";

import { type archestraApiTypes, DocsPage } from "@archestra/shared";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Boxes,
  Building2,
  Edit,
  Info,
  Key,
  Network,
  Plus,
  Trash2,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSetCostsAction } from "@/app/llm/(costs)/layout";
import { AgentIcon } from "@/components/agent-icon";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EnvironmentScopeSelect } from "@/components/environment-scope-select";
import { ExternalDocsLink } from "@/components/external-docs-link";
import { FormDialog } from "@/components/form-dialog";
import {
  CLEANUP_INTERVAL_LABELS,
  DEFAULT_LIMIT_CLEANUP_INTERVAL,
  type LimitCleanupInterval,
  LimitCleanupIntervalSelect,
} from "@/components/limit-cleanup-interval-select";
import { LlmModelPicker } from "@/components/llm-model-picker";
import { LlmModelSearchableSelect } from "@/components/llm-model-select";
import { LoadingSpinner, LoadingWrapper } from "@/components/loading";
import { WithPermissions } from "@/components/roles/with-permissions";
import { TableRowActions } from "@/components/table-row-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  DialogBody,
  DialogForm,
  DialogStickyFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionButton } from "@/components/ui/permission-button";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserSearchableSelect } from "@/components/user-searchable-select";
import { VirtualKeySearchableSelect } from "@/components/virtual-key-searchable-select";
import { useProfiles } from "@/lib/agent.query";
import { useDefaultUserLimits } from "@/lib/default-user-limit.query";
import { getFrontendDocsUrl } from "@/lib/docs/docs";
import { useEnvironments } from "@/lib/environment.query";
import { useDataTableQueryParams } from "@/lib/hooks/use-data-table-query-params";
import {
  useCreateLimit,
  useDeleteLimit,
  useLimits,
  useUpdateLimit,
} from "@/lib/limits.query";
import { useModelsWithApiKeys } from "@/lib/llm-models.query";
import {
  useOrganization,
  useOrganizationMembers,
} from "@/lib/organization.query";
import { useTeams } from "@/lib/teams/team.query";
import { useAllVirtualApiKeys } from "@/lib/virtual-api-keys.query";

type LimitData = archestraApiTypes.GetLimitsResponses["200"][number];
type LimitEntityType = archestraApiTypes.CreateLimitData["body"]["entityType"];
type UsageStatus = "safe" | "warning" | "danger";

// llm_proxy is a type of agent
// It is more convenient and clear to handle it as a separate entity on the frontend
type LimitFormEntityType = LimitEntityType | "llm_proxy";

type LimitFormState = {
  entityType: LimitFormEntityType;
  entityId: string;
  limitValue: string;
  cleanupInterval: LimitCleanupInterval;
  models: string[];
  isAllModels: boolean;
};

const DEFAULT_FORM_STATE: LimitFormState = {
  entityType: "organization",
  entityId: "",
  limitValue: "",
  cleanupInterval: DEFAULT_LIMIT_CLEANUP_INTERVAL,
  models: [],
  isAllModels: true,
};

const LIMITS_ENTITY_SELECTOR_PAGE_SIZE = 100;
const MAX_VISIBLE_MODEL_BADGES = 3;

const ENTITY_TYPE_ITEMS: Array<{
  value: LimitFormEntityType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    value: "organization",
    label: "Organization",
    description: "A shared budget across all LLM spend in your organization.",
    icon: <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />,
  },
  {
    value: "team",
    label: "Team",
    description:
      "Caps the combined spend of every agent and LLM proxy in a team.",
    icon: <Users className="h-4 w-4 shrink-0 text-muted-foreground" />,
  },
  {
    value: "agent",
    label: "Agent",
    description: "Caps spend for a single agent.",
    icon: (
      <AgentIcon
        icon={null}
        fallbackType="agent"
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
    ),
  },
  {
    value: "llm_proxy",
    label: "LLM Proxy",
    description: "Caps spend for a single LLM proxy.",
    icon: <Network className="h-4 w-4 shrink-0 text-muted-foreground" />,
  },
  {
    value: "user",
    label: "User",
    description: "Caps one user's spend across the whole organization.",
    icon: <User className="h-4 w-4 shrink-0 text-muted-foreground" />,
  },
  {
    value: "virtual_key",
    label: "Virtual Key",
    description:
      "Caps spend for requests made with a specific virtual API key.",
    icon: <Key className="h-4 w-4 shrink-0 text-muted-foreground" />,
  },
  {
    value: "environment",
    label: "Environment",
    description: "Caps the combined spend of all users in a deployment environment (e.g. production).",
    icon: <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />,
  },
];

function formatCurrencyWhole(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumericInput(value: string) {
  if (!value) return "";
  return Number(value).toLocaleString("en-US");
}

// NEW: Countdown badge component
function ResetCountdownBadge({ 
  lastCleanup, 
  cleanupInterval 
}: { 
  lastCleanup: LimitData["lastCleanup"];
  cleanupInterval: LimitCleanupInterval;
}) {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    const calculateTimeLeft = () => {
      let nextReset: Date;
      
      if (isCalendarCleanupInterval(cleanupInterval)) {
        nextReset = getNextCalendarResetDate(new Date(), cleanupInterval);
      } else if (lastCleanup) {
        nextReset = addCleanupInterval(new Date(lastCleanup), cleanupInterval);
      } else {
        setTimeLeft("Next check");
        return;
      }

      const now = new Date();
      const diff = nextReset.getTime() - now.getTime();
      
      if (diff <= 0) {
        setTimeLeft("Resetting...");
        setIsUrgent(true);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h`);
        setIsUrgent(false);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
        setIsUrgent(hours < 2);
      } else {
        setTimeLeft(`${minutes}m`);
        setIsUrgent(true);
      }
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [lastCleanup, cleanupInterval]);

  return (
    <Badge 
      variant={isUrgent ? "destructive" : "secondary"}
      className="text-xs"
    >
      {timeLeft}
    </Badge>
  );
}

// Helper function to check if cleanup interval is calendar-based
function isCalendarCleanupInterval(interval: LimitCleanupInterval): boolean {
  return ["daily", "weekly", "monthly", "yearly"].includes(interval);
}

// Helper function to get next calendar reset date
function getNextCalendarResetDate(now: Date, interval: LimitCleanupInterval): Date {
  const next = new Date(now);
  
  switch (interval) {
    case "daily":
      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      break;
    case "weekly":
      next.setDate(next.getDate() + (7 - next.getDay()));
      next.setHours(0, 0, 0, 0);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1, 1);
      next.setHours(0, 0, 0, 0);
      break;
    case "yearly":
      next.setFullYear(next.getFullYear() + 1, 0, 1);
      next.setHours(0, 0, 0, 0);
      break;
  }
  
  return next;
}

// Helper function to add cleanup interval to a date
function addCleanupInterval(date: Date, interval: LimitCleanupInterval): Date {
  const next = new Date(date);
  
  switch (interval) {
    case "1h":
      next.setHours(next.getHours() + 1);
      break;
    case "6h":
      next.setHours(next.getHours() + 6);
      break;
    case "12h":
      next.setHours(next.getHours() + 12);
      break;
    case "24h":
      next.setDate(next.getDate() + 1);
      break;
    case "7d":
      next.setDate(next.getDate() + 7);
      break;
    case "30d":
      next.setDate(next.getDate() + 30);
      break;
    default:
      // Calendar intervals
      return getNextCalendarResetDate(date, interval);
  }
  
  return next;
}

export default function LimitsPage() {
  const setActionButton = useSetCostsAction();
  const { data: limits = [], isPending } = useLimits();
  const { data: teams = [] } = useTeams();
  const { data: organization } = useOrganization();
  const { data: members = [] } = useOrganizationMembers();
  const { data: defaultUserLimits = [] } = useDefaultUserLimits();
  const { data: virtualKeysData } = useAllVirtualApiKeys({
    limit: LIMITS_ENTITY_SELECTOR_PAGE_SIZE,
  });
  const virtualKeys = virtualKeysData?.data ?? [];
  const { data: agents = [] } = useProfiles({
    filters: { agentTypes: ["agent"] },
  });
  const { data: llmProxies = [] } = useProfiles({
    filters: { agentTypes: ["llm_proxy"] },
  });
  const { data: environmentsData } = useEnvironments();
  const environments = environmentsData?.environments ?? [];
  const { data: modelsWithApiKeys = [] } = useModelsWithApiKeys();
  const createLimit = useCreateLimit();
  const updateLimit = useUpdateLimit();
  const deleteLimit = useDeleteLimit();

  const { searchParams, updateQueryParams } = useDataTableQueryParams();
  const statusFilter = searchParams.get("status") || "all";
  const appliedToFilter = searchParams.get("appliedTo") || "all";
  const modelFilter = searchParams.get("model") || "all";
  const [editingLimit, setEditingLimit] = useState<LimitData | null>(null);
  const [limitToDelete, setLimitToDelete] = useState<LimitData | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formState, setFormState] =
    useState<LimitFormState>(DEFAULT_FORM_STATE);

  const llmLimits = useMemo(
    () => limits.filter((limit) => limit.limitType === "token_cost"),
    [limits],
  );

  const modelOptions = useMemo(
    () =>
      modelsWithApiKeys.map((model) => ({
        value: model.modelId,
        model: model.modelId,
        provider: model.provider,
        pricePerMillionInput: model.pricePerMillionInput ?? "0",
        pricePerMillionOutput: model.pricePerMillionOutput ?? "0",
      })),
    [modelsWithApiKeys],
  );

  const handleCreateOpen = useCallback(() => {
    setEditingLimit(null);
    setFormState(DEFAULT_FORM_STATE);
    setIsDialogOpen(true);
  }, []);

  useEffect(() => {
    setActionButton(
      <PermissionButton
        permissions={{ llmLimit: ["create"] }}
        onClick={handleCreateOpen}
      >
        <Plus className="h-4 w-4" />
        Add Limit
      </PermissionButton>,
    );

    return () => setActionButton(null);
  }, [handleCreateOpen, setActionButton]);

  const handleEditOpen = useCallback(
    (limit: LimitData) => {
      setEditingLimit(limit);
      const models = getLimitModels(limit);
      const isAllModels =
        models.length === 0 && limit.limitType === "token_cost";

      let entityType: LimitFormEntityType = limit.entityType;
      if (limit.entityType === "agent") {
        const isLlmProxy = llmProxies.some(
          (candidate) => candidate.id === limit.entityId,
        );
        if (isLlmProxy) {
          entityType = "llm_proxy";
        }
      }

      setFormState({
        entityType,
        entityId: limit.entityType === "organization" ? "" : limit.entityId,
        limitValue: String(limit.limitValue),
        cleanupInterval:
          limit.cleanupInterval ?? DEFAULT_LIMIT_CLEANUP_INTERVAL,
        models: isAllModels ? [] : models,
        isAllModels,
      });
      setIsDialogOpen(true);
    },
    [llmProxies],
  );

  const getEntityLabel = useCallback(
    (limit: LimitData) => {
      if (limit.entityType === "organization") {
        return "Organization";
      }
      if (limit.entityType === "team") {
        const team = teams.find((candidate) => candidate.id === limit.entityId);
        return team?.name ?? "Unknown team";
      }
      if (limit.entityType === "user") {
        const member = members.find(
          (candidate) => candidate.id === limit.entityId,
        );
        return member?.name ?? member?.email ?? "Unknown user";
      }
      if (limit.entityType === "virtual_key") {
        const key = virtualKeys.find(
          (candidate) => candidate.id === limit.entityId,
        );
        return key?.name ?? "Unknown key";
      }
      if (limit.entityType === "agent") {
        const agent = agents.find(
          (candidate) => candidate.id === limit.entityId,
        );
        if (agent) {
          return agent.name ?? "Unknown agent";
        }
        const proxy = llmProxies.find(
          (candidate) => candidate.id === limit.entityId,
        );
        return proxy?.name ?? "Unknown LLM proxy";
      }
      if (limit.entityType === "environment") {
        const environment = environments.find(
          (candidate) => candidate.id === limit.entityId,
        );
        return environment?.name ?? "Unknown environment";
      }
      return "Unknown";
    },
    [teams, members, virtualKeys, agents, llmProxies, environments],
  );

  const getEntityIcon = useCallback(
    (limit: LimitData) => {
      const iconClassName = "h-4 w-4 shrink-0 text-muted-foreground";
      if (limit.entityType === "organization") {
        return <Building2 className={iconClassName} />;
      }
      if (limit.entityType === "team") {
        return <Users className={iconClassName} />;
      }
      if (limit.entityType === "user") {
        return <User className={iconClassName} />;
      }
      if (limit.entityType === "virtual_key") {
        return <Key className={iconClassName} />;
      }
      if (limit.entityType === "environment") {
        return <Boxes className={iconClassName} />;
      }
      if (
        limit.entityType === "agent" &&
        llmProxies.some((candidate) => candidate.id === limit.entityId)
      ) {
        return <Network className={iconClassName} />;
      }
      return (
        <AgentIcon icon={null} fallbackType="agent" className={iconClassName} />
      );
    },
    [llmProxies],
  );

  const getUsageStatus = useCallback(
    (
      limit: LimitData,
    ): {
      percentage: number;
      status: UsageStatus;
      actualUsage: number;
      actualLimit: number;
    } => {
      const actualUsage = (limit.modelUsage ?? []).reduce(
        (sum, usage) => sum + usage.cost,
        0,
      );
      const actualLimit = limit.limitValue;
      const percentage =
        actualLimit > 0 ? (actualUsage / actualLimit) * 100 : 0;
      if (percentage >= 90) {
        return { percentage, status: "danger", actualUsage, actualLimit };
      }
      if (percentage >= 75) {
        return { percentage, status: "warning", actualUsage, actualLimit };
      }
      return { percentage, status: "safe", actualUsage, actualLimit };
    },
    [],
  );

  const filteredLimits = useMemo(() => {
    return llmLimits.filter((limit) => {
      const usageStatus = getUsageStatus(limit).status;
      const matchesStatus =
        statusFilter === "all" || usageStatus === statusFilter;
      const matchesAppliedTo =
        appliedToFilter === "all" ||
        (appliedToFilter === "agent" &&
          limit.entityType === "agent" &&
          agents.some((candidate) => candidate.id === limit.entityId)) ||
        (appliedToFilter === "llm_proxy" &&
          limit.entityType === "agent" &&
          llmProxies.some((candidate) => candidate.id === limit.entityId)) ||
        (appliedToFilter !== "agent" &&
          appliedToFilter !== "llm_proxy" &&
          limit.entityType === appliedToFilter);
      const isAllModelsLimit =
        limit.limitType === "token_cost" &&
        (!limit.model ||
          (Array.isArray(limit.model) && limit.model.length === 0));
      const matchesModel =
        modelFilter === "all" ||
        (Array.isArray(limit.model) && limit.model.includes(modelFilter)) ||
        isAllModelsLimit;

      return matchesStatus && matchesAppliedTo && matchesModel;
    });
  }, [
    appliedToFilter,
    llmLimits,
    modelFilter,
    statusFilter,
    getUsageStatus,
    agents,
    llmProxies,
  ]);

  const columns = useMemo<ColumnDef<LimitData>[]>(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        size: 100,
        minSize: 80,
        cell: ({ row }) => {
          const status = getUsageStatus(row.original).status;
          return (
            <Badge
              variant={
                status === "danger"
                  ? "destructive"
                  : status === "warning"
                    ? "secondary"
                    : "outline"
              }
            >
              {status === "danger"
                ? "Exceeded"
                : status === "warning"
                  ? "Near limit"
                  : "Safe"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "entityId",
        header: "Applied to",
        size: 150,
        minSize: 120,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            {getEntityIcon(row.original)}
            <span className="truncate">{getEntityLabel(row.original)}</span>
          </div>
        ),
      },
      {
        accessorKey: "model",
        header: "Models",
        size: 250,
        minSize: 180,
        cell: ({ row }) => {
          const models = getLimitModels(row.original);
          const isAllModels =
            models.length === 0 && row.original.limitType === "token_cost";
          const visibleModels = models.slice(0, MAX_VISIBLE_MODEL_BADGES);
          const remainingModels = models.slice(MAX_VISIBLE_MODEL_BADGES);
          return (
            <div className="flex flex-wrap gap-1">
              {isAllModels && (
                <Badge
                  variant="outline"
                  className="text-xs"
                  data-testid="limits-table-models-badge"
                >
                  All models
                </Badge>
              )}
              {!isAllModels &&
                visibleModels.map((model) => (
                  <Badge
                    key={model}
                    variant="outline"
                    className="text-xs"
                    data-testid="limits-table-models-badge"
                  >
                    {model}
                  </Badge>
                ))}
              {remainingModels.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="cursor-default text-xs"
                      data-testid="limits-table-models-more-badge"
                    >
                      +{remainingModels.length} more
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    <div className="space-y-1">
                      {remainingModels.map((model) => (
                        <div key={model}>{model}</div>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "cleanupInterval",
        header: "Cleanup",
        size: 180, // Increased size for countdown badge
        minSize: 150,
        cell: ({ row }) => {
          const cleanupInterval =
            (row.original.cleanupInterval as LimitCleanupInterval | null) ??
            DEFAULT_LIMIT_CLEANUP_INTERVAL;
          return (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span>{CLEANUP_INTERVAL_LABELS[cleanupInterval]}</span>
                {/* NEW: Countdown badge */}
                <ResetCountdownBadge
                  lastCleanup={row.original.lastCleanup}
                  cleanupInterval={cleanupInterval}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {formatNextLimitReset(
                  row.original.lastCleanup,
                  cleanupInterval,
                )}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "usage",
        header: "Usage",
        size: 200,
        minSize: 160,
        cell: ({ row }) => {
          const usage = getUsageStatus(row.original);
          return (
            <div className="w-[180px]">
              <Progress
                value={Math.min(usage.percentage, 100)}
                className={
                  usage.status === "danger"
                    ? "bg-red-100"
                    : usage.status === "warning"
                      ? "bg-orange-100"
                      : undefined
                }
              />
              <p className="mt-1 text-left text-xs text-muted-foreground">
                {`${formatCurrencyWhole(usage.actualUsage)} / ${formatCurrencyWhole(usage.actualLimit)} (${usage.percentage.toFixed(1)}%)`}
              </p>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        size: 100,
        minSize: 80,
        cell: ({ row }) => (
          <TableRowActions
            actions={[
              {
                icon: <Edit className="h-4 w-4" />,
                label: "Edit limit",
                onClick: () => handleEditOpen(row.original),
              },
              {
                icon: <Trash2 className="h-4 w-4" />,
                label: "Delete limit",
                variant: "destructive",
                onClick: () => setLimitToDelete(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [getEntityIcon, getEntityLabel, getUsageStatus, handleEditOpen],
  );

  const hasActiveFilters =
    statusFilter !== "all" ||
    appliedToFilter !== "all" ||
    modelFilter !== "all";
  const shouldShowDefaultUserLimitNotice =
    formState.entityType === "user" && defaultUserLimits.length > 0;
  const limitsDocsUrl = getFrontendDocsUrl(
    DocsPage.PlatformCostsAndLimits,
    "usage-limits",
  );

  async function handleSubmit() {
    const entityType =
      formState.entityType === "llm_proxy" ? "agent" : formState.entityType;
    const body = {
      entityType,
      entityId:
        formState.entityType === "organization"
          ? (organization?.id ?? "")
          : formState.entityId,
      limitType: "token_cost" as const,
      limitValue: Number(formState.limitValue),
      cleanupInterval: formState.cleanupInterval,
      model: formState.isAllModels ? null : formState.models,
    };

    if (editingLimit) {
      const result = await updateLimit.mutateAsync({
        id: editingLimit.id,
        ...body,
      });
      if (result) {
        setIsDialogOpen(false);
        setEditingLimit(null);
      }
      return;
    }

    const result = await createLimit.mutateAsync(body);
    if (result) {
      setIsDialogOpen(false);
    }
  }

  async function handleDelete() {
    if (!limitToDelete) return;
    await deleteLimit.mutateAsync({ id: limitToDelete.id });
    setLimitToDelete(null);
  }

  const canSubmit =
    Number(formState.limitValue) > 0 &&
    (formState.isAllModels || formState.models.length > 0) &&
    (formState.entityType === "organization" || formState.entityId.length > 0);

  return (
    <div className="space-y-4">
      {defaultUserLimits.length > 0 && (
        <WithPermissions
          permissions={{ llmLimit: ["read"] }}
          noPermissionHandle="hide"
        >
          <Alert variant="info">
            <AlertDescription className="block">
              A default user limit applies to every user. Custom per-user limits
              override it. Configure it in{" "}
              <Link
                href="/settings/llm"
                className="font-medium underline underline-offset-4"
              >
                LLM settings
              </Link>
              .
            </AlertDescription>
          </Alert>
        </WithPermissions>
      )}

      <div className="flex flex-wrap gap-3">
        <Select
          value={statusFilter}
          onValueChange={(value) =>
            updateQueryParams({ status: value === "all" ? null : value })
          }
        >
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="safe">Safe</SelectItem>
            <SelectItem value="warning">Near limit</SelectItem>
            <SelectItem value="danger">Exceeded</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={appliedToFilter}
          onValueChange={(value) =>
            updateQueryParams({ appliedTo: value === "all" ? null : value })
          }
        >
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="All scopes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scopes</SelectItem>
            <SelectItem value="organization">Organization</SelectItem>
            <SelectItem value="team">Team</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="llm_proxy">LLM Proxy</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="virtual_key">Virtual Key</SelectItem>
            <SelectItem value="environment">Environment</SelectItem>
          </SelectContent>
        </Select>

        <LlmModelSearchableSelect
          models={modelOptions}
          value={modelFilter}
          onValueChange={(value) =>
            updateQueryParams({ model: value === "all" ? null : value })
          }
          placeholder="All models"
          className="w-full sm:w-[220px]"
        />

        {hasActiveFilters && (
          <Button
            variant="ghost"
            onClick={() =>
              updateQueryParams({ status: null, appliedTo: null, model: null })
            }
          >
            Clear filters
          </Button>
        )}
      </div>

      <LoadingWrapper isPending={isPending}>
        <DataTable
          columns={columns}
          data={filteredLimits}
          noResultsMessage="No limits found"
          data-testid="limits-table"
        />
      </LoadingWrapper>

      <FormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        title={editingLimit ? "Edit limit" : "Create limit"}
      >
        <DialogForm onSubmit={handleSubmit}>
          <DialogBody>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Scope</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ENTITY_TYPE_ITEMS.map((item) => (
                    <Button
                      key={item.value}
                      variant={
                        formState.entityType === item.value
                          ? "default"
                          : "outline"
                      }
                      className="h-auto justify-start gap-2 p-3"
                      onClick={() =>
                        setFormState((prev) => ({
                          ...prev,
                          entityType: item.value,
                          entityId: "",
                        }))
                      }
                      type="button"
                    >
                      {item.icon}
                      <div className="text-left">
                        <div className="font-medium">{item.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.description}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>

              {formState.entityType !== "organization" && (
                <div className="space-y-2">
                  <Label>
                    {formState.entityType === "team"
                      ? "Team"
                      : formState.entityType === "user"
                        ? "User"
                        : formState.entityType === "virtual_key"
                          ? "Virtual Key"
                          : formState.entityType === "environment"
                            ? "Environment"
                            : formState.entityType === "llm_proxy"
                              ? "LLM Proxy"
                              : "Agent"}
                  </Label>
                  {formState.entityType === "team" ? (
                    <SearchableSelect
                      options={teams.map((team) => ({
                        value: team.id,
                        label: team.name,
                      }))}
                      value={formState.entityId}
                      onValueChange={(value) =>
                        setFormState((prev) => ({ ...prev, entityId: value }))
                      }
                      placeholder="Select team"
                    />
                  ) : formState.entityType === "user" ? (
                    <UserSearchableSelect
                      value={formState.entityId}
                      onValueChange={(value) =>
                        setFormState((prev) => ({ ...prev, entityId: value }))
                      }
                      placeholder="Select user"
                    />
                  ) : formState.entityType === "virtual_key" ? (
                    <VirtualKeySearchableSelect
                      value={formState.entityId}
                      onValueChange={(value) =>
                        setFormState((prev) => ({ ...prev, entityId: value }))
                      }
                      placeholder="Select virtual key"
                    />
                  ) : formState.entityType === "environment" ? (
                    <SearchableSelect
                      options={environments.map((env) => ({
                        value: env.id,
                        label: env.name,
                      }))}
                      value={formState.entityId}
                      onValueChange={(value) =>
                        setFormState((prev) => ({ ...prev, entityId: value }))
                      }
                      placeholder="Select environment"
                    />
                  ) : formState.entityType === "llm_proxy" ? (
                    <SearchableSelect
                      options={llmProxies.map((proxy) => ({
                        value: proxy.id,
                        label: proxy.name ?? "Unknown LLM proxy",
                      }))}
                      value={formState.entityId}
                      onValueChange={(value) =>
                        setFormState((prev) => ({ ...prev, entityId: value }))
                      }
                      placeholder="Select LLM proxy"
                    />
                  ) : (
                    <SearchableSelect
                      options={agents.map((agent) => ({
                        value: agent.id,
                        label: agent.name ?? "Unknown agent",
                      }))}
                      value={formState.entityId}
                      onValueChange={(value) =>
                        setFormState((prev) => ({ ...prev, entityId: value }))
                      }
                      placeholder="Select agent"
                    />
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>Limit value (USD)</Label>
                <Input
                  type="text"
                  value={formatNumericInput(formState.limitValue)}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9.]/g, "");
                    setFormState((prev) => ({ ...prev, limitValue: value }));
                  }}
                  placeholder="Enter limit amount"
                />
                {shouldShowDefaultUserLimitNotice && (
                  <p className="text-sm text-muted-foreground">
                    This will override the default user limit of{" "}
                    {formatCurrencyWhole(defaultUserLimits[0].limitValue)}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Cleanup interval</Label>
                <LimitCleanupIntervalSelect
                  value={formState.cleanupInterval}
                  onValueChange={(value) =>
                    setFormState((prev) => ({
                      ...prev,
                      cleanupInterval: value,
                    }))
                  }
                />
                <p className="text-sm text-muted-foreground">
                  Usage resets at this interval
                </p>
              </div>

              <div className="space-y-2">
                <Label>Models</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="all-models"
                    checked={formState.isAllModels}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        isAllModels: e.target.checked,
                        models: e.target.checked ? [] : prev.models,
                      }))
                    }
                  />
                  <Label htmlFor="all-models" className="font-normal">
                    Apply to all models
                  </Label>
                </div>
                {!formState.isAllModels && (
                  <LlmModelPicker
                    models={modelOptions}
                    selectedModels={formState.models}
                    onSelectionChange={(models) =>
                      setFormState((prev) => ({ ...prev, models }))
                    }
                  />
                )}
              </div>
            </div>
          </DialogBody>
          <DialogStickyFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <PermissionButton
              permissions={
                editingLimit
                  ? { llmLimit: ["update"] }
                  : { llmLimit: ["create"] }
              }
              type="submit"
              disabled={!canSubmit}
            >
              {editingLimit ? "Update" : "Create"}
            </PermissionButton>
          </DialogStickyFooter>
        </DialogForm>
      </FormDialog>

      <DeleteConfirmDialog
        open={!!limitToDelete}
        onOpenChange={(open) => !open && setLimitToDelete(null)}
        onConfirm={handleDelete}
        title="Delete limit"
        description={`Are you sure you want to delete this limit? This action cannot be undone.`}
      />

      <ExternalDocsLink url={limitsDocsUrl} />
    </div>
  );
}

function formatNextLimitReset(
  lastCleanup: LimitData["lastCleanup"],
  cleanupInterval: LimitCleanupInterval,
): string {
  if (isCalendarCleanupInterval(cleanupInterval)) {
    return formatResetDate(
      getNextCalendarResetDate(new Date(), cleanupInterval),
    );
  }

  if (!lastCleanup) {
    return "Resets on next check";
  }

  const nextReset = addCleanupInterval(new Date(lastCleanup), cleanupInterval);
  if (Number.isNaN(nextReset.getTime())) {
    return "Reset schedule unavailable";
  }

  return formatResetDate(nextReset);
}

function formatResetDate(date: Date): string {
  return `Resets ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })}`;
}

function getLimitModels(limit: LimitData): string[] {
  if (Array.isArray(limit.model)) {
    return limit.model;
  }
  if (typeof limit.model === "string" && limit.model) {
    return [limit.model];
  }
  return [];
}
