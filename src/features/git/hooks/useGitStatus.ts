import { useCallback, useEffect, useRef, useState } from "react";
import type { GitFileStatus, WorkspaceInfo } from "../../../types";
import { getGitStatus } from "../../../services/tauri";

type GitStatusState = {
  branchName: string;
  files: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  totalAdditions: number;
  totalDeletions: number;
  error: string | null;
};

const emptyStatus: GitStatusState = {
  branchName: "",
  files: [],
  stagedFiles: [],
  unstagedFiles: [],
  totalAdditions: 0,
  totalDeletions: 0,
  error: null,
};

const REFRESH_INTERVAL_MS = 5000;

function sameFileStatusLists(a: GitFileStatus[], b: GitFileStatus[]) {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.path !== right.path
      || left.status !== right.status
      || left.additions !== right.additions
      || left.deletions !== right.deletions
    ) {
      return false;
    }
  }
  return true;
}

function sameStatusState(a: GitStatusState, b: GitStatusState) {
  return (
    a.branchName === b.branchName
    && a.error === b.error
    && a.totalAdditions === b.totalAdditions
    && a.totalDeletions === b.totalDeletions
    && sameFileStatusLists(a.files, b.files)
    && sameFileStatusLists(a.stagedFiles, b.stagedFiles)
    && sameFileStatusLists(a.unstagedFiles, b.unstagedFiles)
  );
}

export function useGitStatus(activeWorkspace: WorkspaceInfo | null) {
  const [status, setStatus] = useState<GitStatusState>(emptyStatus);
  const requestIdRef = useRef(0);
  const workspaceIdRef = useRef<string | null>(activeWorkspace?.id ?? null);
  const cachedStatusRef = useRef<Map<string, GitStatusState>>(new Map());
  const workspaceId = activeWorkspace?.id ?? null;

  const resolveBranchName = useCallback(
    (incoming: string | undefined, cached: GitStatusState | undefined) => {
      const trimmed = incoming?.trim();
      if (trimmed && trimmed !== "unknown") {
        return trimmed;
      }
      const cachedBranch = cached?.branchName?.trim();
      return cachedBranch && cachedBranch !== "unknown"
        ? cachedBranch
        : trimmed ?? "";
    },
    [],
  );

  const refresh = useCallback(() => {
    if (!workspaceId) {
      setStatus(emptyStatus);
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    return getGitStatus(workspaceId)
      .then((data) => {
        if (
          requestIdRef.current !== requestId ||
          workspaceIdRef.current !== workspaceId
        ) {
          return;
        }
        const cached = cachedStatusRef.current.get(workspaceId);
        const resolvedBranchName = resolveBranchName(data.branchName, cached);
        const nextStatus = {
          ...data,
          branchName: resolvedBranchName,
          error: null,
        };
        setStatus((prev) => (sameStatusState(prev, nextStatus) ? prev : nextStatus));
        cachedStatusRef.current.set(workspaceId, nextStatus);
      })
      .catch((err) => {
        console.error("Failed to load git status", err);
        if (
          requestIdRef.current !== requestId ||
          workspaceIdRef.current !== workspaceId
        ) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const cached = cachedStatusRef.current.get(workspaceId);
        const nextStatus = cached
          ? { ...cached, error: message }
          : { ...emptyStatus, branchName: "unknown", error: message };
        setStatus((prev) => (sameStatusState(prev, nextStatus) ? prev : nextStatus));
      });
  }, [resolveBranchName, workspaceId]);

  useEffect(() => {
    if (workspaceIdRef.current !== workspaceId) {
      workspaceIdRef.current = workspaceId;
      requestIdRef.current += 1;
      if (!workspaceId) {
        setStatus(emptyStatus);
        return;
      }
      const cached = cachedStatusRef.current.get(workspaceId);
      setStatus(cached ?? emptyStatus);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setStatus(emptyStatus);
      return;
    }

    const fetchStatus = () => {
      refresh()?.catch(() => {});
    };

    fetchStatus();
    const interval = window.setInterval(fetchStatus, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [refresh, workspaceId]);

  return { status, refresh };
}
