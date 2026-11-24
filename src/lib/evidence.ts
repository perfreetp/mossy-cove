import type { EvidenceType } from '../types';

export interface EvidenceMeta {
  type: EvidenceType;
  label: string;
  /** 平面图/三维标记颜色 */
  color: string;
  /** 单字缩写，用于标记图标 */
  icon: string;
}

export const EVIDENCE_META: Record<EvidenceType, EvidenceMeta> = {
  blood: { type: 'blood', label: '血迹', color: '#e23b3b', icon: '血' },
  weapon: { type: 'weapon', label: '凶器', color: '#f08a1e', icon: '刃' },
  fingerprint: { type: 'fingerprint', label: '指纹', color: '#8b5cf6', icon: '纹' },
  trace: { type: 'trace', label: '痕迹物证', color: '#0ea5e9', icon: '痕' },
  body: { type: 'body', label: '尸体', color: '#64748b', icon: '体' },
  other: { type: 'other', label: '其他', color: '#22c55e', icon: '他' }
};

export const EVIDENCE_LIST: EvidenceMeta[] = Object.values(EVIDENCE_META);
