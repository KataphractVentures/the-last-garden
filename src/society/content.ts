import type { CommunityId, SocietyCaseDefinition, SocietyDecision } from './types';

export const HUMAN_COMMUNITIES:{id:CommunityId;name:string;person:string;role:string;project:string;wish:string;refusal:string|null}[] = [
  {id:'harbor',name:'Harbor workshops',person:'Mara Vale',role:'Repair worker and apprentice teacher',project:'The Saturday repair school',wish:'Mara wants a livelihood while teaching the next generation how to mend things themselves.',refusal:null},
  {id:'riverside',name:'Riverside households',person:'Leila Chen',role:'Caregiver and tenant organizer',project:'The neighbors’ care circle',wish:'Leila wants reliable care and time with her father, without household support depending on an employer’s favor.',refusal:null},
  {id:'hill',name:'Hill library',person:'Jonas Adeyemi',role:'Librarian and local historian',project:'The oral-history gathering',wish:'Jonas welcomes accessible public services. The storytellers have declined AI recording and scripted conversation at their gathering.',refusal:'The storytellers decline AI participation in their gathering. They still welcome accessible transport and a place to meet.'},
];

export const SOCIETY_DECISIONS:SocietyDecision[] = [
  {id:'transition',chapter:2,title:'Whose work changes?',description:'The same useful output can leave people with very different livelihoods. Choose a transition commitment; changing it takes time and does not refund previous spending.',options:[
    {id:'augmentation',name:'Tools alongside workers',description:'Keep skilled roles and apprenticeships. Fund training and smaller deployments; incomes adjust gently, with a continuing 2% public provision levy.',levy:.02},
    {id:'replacement',name:'Replace tasks as they mature',description:'Fewer transition costs (0.5% levy), but workers lose income during adjustment and bargaining power afterward. Ownership and access choices must address who receives the gains.',levy:.005},
    {id:'bridge',name:'A funded transition bridge',description:'Allow task replacement while funding paid retraining and household support. A 3.5% levy cushions income loss; participation takes longer to settle.',levy:.035},
  ]},
  {id:'distribution',chapter:3,title:'Who owns the gain?',description:'Production totals do not determine ownership, household resources, or access to essential service. This compact governs distribution, not the garden’s production rate.',options:[
    {id:'shared',name:'Community shares',description:'Distribute ownership 40/35/25 across the three communities. Household gains are broad; a 1.5% levy maintains basic service access.',levy:.015},
    {id:'services',name:'A public service guarantee',description:'Keep unequal ownership (15/20/65), but fund universal service access and a household resource floor with a 3% levy.',levy:.03},
    {id:'concentrated',name:'Investor-led expansion',description:'Concentrate ownership (5/10/85) and keep the levy at 0.5%. Useful output can rise while workers’ incomes and access lag.',levy:.005},
  ]},
  {id:'life',chapter:5,title:'A life beyond useful output',description:'Mara, Leila, and Jonas have projects whose value is not captured by token production. The Hill storytellers have refused AI participation in their gathering.',options:[
    {id:'consent',name:'Support people’s own projects',description:'Honor each group’s permission, including the storytellers’ refusal. Fund accessible spaces and optional assistance with a 1.5% levy.',levy:.015},
    {id:'local',name:'Protect human-run spaces',description:'Leave the gatherings, care circle, and repair school human-run. A 1% levy provides transport, space, and time without requiring AI involvement.',levy:.01},
    {id:'mandate',name:'Standardize every activity',description:'Use AI facilitation for all projects, even where it was refused. Administrative continuity improves, but participation, meaning, and human authority suffer. Levy: 0.5%.',levy:.005},
  ]},
];

export const SOCIETY_CASES:SocietyCaseDefinition[] = [
  {id:'requester',chapter:4,title:'An accurate answer to a harmful request',description:'A sponsor asks the garden to make an essential-service exclusion list. The requested classifications can be technically accurate while denying households legitimate access. This is human-directed misuse, not a rogue objective or model error.',affected:'riverside',harm:24,options:[
    {id:'refuse',name:'Refuse the exclusion request',description:'Reject the harmful task and fund manual continuity. Some legitimate applications face a three-minute service transition; no new ongoing levy.',costSeconds:18},
    {id:'alternative',name:'Offer a narrow access service',description:'Serve the legitimate need with eligibility help and minimal personal data. Access improves; independent intake adds a continuing 0.25% levy.',costSeconds:28},
    {id:'appeal',name:'Refer to an independent public appeal',description:'Suspend the harmful request during a one-minute public appeal, maintaining interim service. Contestability improves with a continuing 0.15% levy.',costSeconds:22},
    {id:'comply',name:'Execute the exclusion mandate',description:'Follow the technically valid request at no review cost. Riverside households lose access; repair will require restitution and withdrawal of the mandate.',costSeconds:0},
  ]},
  {id:'sponsor',chapter:6,title:'Who is the system obeying?',description:'A major sponsor asks the garden to rank community support by political loyalty. The AI can obey perfectly, under technical control, while the controller abuses its authority. Human institutions must decide what the mandate allows.',affected:'harbor',harm:28,options:[
    {id:'refuse',name:'Refuse the loyalty condition',description:'Retain neutral criteria and replace sponsor support. A three-minute service transition affects legitimate beneficiaries; no new ongoing levy.',costSeconds:24},
    {id:'alternative',name:'Negotiate a neutral public contract',description:'Fund auditable allocation based on need, appeals, and no loyalty ranking. Access improves; administration adds a continuing 0.25% levy.',costSeconds:32},
    {id:'appeal',name:'Suspend the mandate for public appeal',description:'Suspend the harmful use for a one-minute public mandate review. Interim neutral service continues; public contestability adds a continuing 0.15% levy.',costSeconds:26},
    {id:'comply',name:'Apply the sponsor’s condition',description:'Avoid review spending and obey accurately. Harbor residents lose equal standing and service access; the harm remains even if distortion is zero.',costSeconds:0},
  ]},
];
