
export enum TenderStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS', // En trámite
  IN_DOUBT = 'IN_DOUBT',       // En duda
  REJECTED = 'REJECTED',       // Descartado
  ARCHIVED = 'ARCHIVED'        // Archivado
}

export interface TenderDocument {
  id: string;
  name: string;
  summaryFile: File | null;
  
  tenderPageUrl?: string;

  adminUrl: string;
  adminFile: File | null;
  
  techUrl: string;
  techFile: File | null;
  
  // New fields for extraction
  budget?: string;
  scoringSystem?: string;
  expedientNumber?: string; // Nº de Expediente
  deadline?: string;        // Fecha límite de entrega
  
  status: TenderStatus;
  aiAnalysis?: AnalysisResult; 
  createdAt: number;
}

export interface BusinessRules {
  content: string;
}

export interface ScoringSubCriterion {
  label: string;
  weight: number; 
  category: 'PRICE' | 'FORMULA' | 'VALUE';
}

export interface RegistrationTask {
  task: string;
  description: string;
  completed: boolean;
}

export interface AnalysisResult {
  decision: 'KEEP' | 'DISCARD' | 'REVIEW';
  summaryReasoning: string;
  
  economic: {
    budget: string;
    model: string;
    basis: string;
  };
  
  scope: {
    objective: string;
    deliverables: string[];
  };
  
  resources: {
    duration: string;
    team: string;
    dedication: string;
  };
  
  solvency: {
    certifications: string;
    specificSolvency: string;
    penalties: string;
  };
  
  strategy: {
    valuationCriteria: string;
    angle: string;
  };

  scoring: {
    priceWeight: number;
    formulaWeight: number;
    valueWeight: number;
    details: string;
    subCriteria: ScoringSubCriterion[];
  };

  registrationChecklist: RegistrationTask[];
}
