import type { ConstitutionId } from '../contracts';
import { EXPERIMENT_TEMPLATES } from './experiments';
import { RESEARCH_PROJECTS } from './projects';
import { isProgramActive } from './programs';

export function activeExperimentTemplates(constitution:ConstitutionId){return EXPERIMENT_TEMPLATES.filter(template=>isProgramActive(template.program,constitution));}
export function activeResearchProjects(constitution:ConstitutionId){return RESEARCH_PROJECTS.filter(project=>project.program==='foundation'||isProgramActive(project.program,constitution));}
