
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
  
  summaryUrl?: string; // URL en Supabase Storage
  summaryFile?: File | null; // Archivo local temporal
  
  tenderPageUrl?: string;

  adminUrl: string; // Puede ser link externo o Supabase Storage
  adminFile?: File | null; // Archivo local temporal
  
  techUrl: string; // Puede ser link externo o Supabase Storage
  techFile?: File | null; // Archivo local temporal
  
  budget?: string;
  scoringSystem?: string;
  expedientNumber?: string;
  deadline?: string;
  
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
