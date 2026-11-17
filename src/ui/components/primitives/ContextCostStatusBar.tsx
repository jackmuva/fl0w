import type { BoxRenderable } from '@opentui/core';
import { useState } from 'react';
import { COMPACTION_TOKEN_THRESHOLD } from '../../../constants';
import { formatSessionCostUsd, formatSessionTokens } from '../../lib/format/session-stats';
import { theme } from "../../theme"

const MIN_BAR_WIDTH = 8;

type ContextCostStatusBarProps = {
  contextPercent: number;
  inputTokens: number;
  sessionCostUsd: number;
};

// The e-reader progress line along the foot of the page: a thin bar filling with context use, stats at its end.
export const ContextCostStatusBar = ({ contextPercent, inputTokens, sessionCostUsd }: ContextCostStatusBarProps) => {
  const [width, setWidth] = useState(0);
  const warmContext = contextPercent >= Math.round(COMPACTION_TOKEN_THRESHOLD * 100);
  const tokensLabel = formatSessionTokens(inputTokens);
  const costLabel = formatSessionCostUsd(sessionCostUsd);
  const label = [
    `${contextPercent}% context · ${tokensLabel} · ${costLabel}`,
    `${contextPercent}% · ${tokensLabel} · ${costLabel}`,
    `${contextPercent}% · ${costLabel}`,
  ].find((candidate) => candidate.length + 2 + MIN_BAR_WIDTH <= width) ?? `${contextPercent}%`;
  const barWidth = Math.max(0, width - label.length - 2);
  const filled = Math.min(barWidth, Math.round((Math.min(contextPercent, 100) / 100) * barWidth));

  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      flexShrink={0}
      marginTop={1}
      onSizeChange={function (this: BoxRenderable) {
        setWidth(this.width);
      }}
    >
      <text fg={theme.edge} selectable={false} wrapMode="none">
        <span fg={warmContext ? theme.clay : theme.graphite}>{"━".repeat(filled)}</span>
        {"─".repeat(barWidth - filled)}
        <span fg={warmContext ? theme.clay : theme.muted}>{`  ${label}`}</span>
      </text>
    </box>
  );
};
