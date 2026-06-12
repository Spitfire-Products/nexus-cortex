---
name: resume-analyst
description: Analyze, improve, and create professional resumes and CVs. Use when the user needs help with resume review, ATS optimization, content improvement, or creating a new resume from scratch.
allowed-tools: Read, Write, Grep, Glob
---

# Resume & CV Analyst

A comprehensive skill for analyzing, improving, and creating professional resumes and CVs with ATS (Applicant Tracking System) optimization.

## When to Use This Skill

- User wants to review or improve an existing resume
- User needs help creating a new resume
- User asks for ATS optimization advice
- User wants feedback on resume structure or content
- User needs to tailor a resume for a specific job posting

## Instructions

### Phase 1: Analysis (Existing Resume)

If the user has an existing resume:

1. **Locate the Resume File**
   - Use Glob to find resume files: `*.pdf`, `*.docx`, `*.txt`, `resume.*`, `cv.*`
   - Common locations: current directory, `~/Documents/`, `~/Desktop/`
   - Ask user for file location if not found

2. **Read and Parse Content**
   - Use Read tool to access the file
   - For PDF: Use Bash with `pdftotext` or `strings` if needed
   - For Word: Use Bash with `antiword` or `docx2txt` if available
   - Extract all text content for analysis

3. **Analyze Resume Structure**
   Check for these essential sections:
   - ✅ Contact Information (name, email, phone, location, LinkedIn/portfolio)
   - ✅ Professional Summary/Objective
   - ✅ Work Experience (with dates, company, role, achievements)
   - ✅ Education (degree, institution, graduation date)
   - ✅ Skills (technical and soft skills)
   - ✅ Optional: Certifications, Projects, Publications, Awards

4. **ATS Optimization Check**
   Evaluate for ATS compatibility:
   - ❌ **Avoid**: Graphics, tables, columns, headers/footers, text boxes, images
   - ✅ **Use**: Simple formatting, standard fonts (Arial, Calibri, Times New Roman)
   - ✅ **Include**: Keywords from job description
   - ✅ **Format**: Standard section headings, consistent date formats
   - ✅ **File Type**: .docx or .txt preferred over PDF for ATS

5. **Content Quality Assessment**
   Evaluate each work experience entry:
   - **Achievement-Focused**: Quantifiable results (increased X by Y%, managed $Z budget)
   - **Action Verbs**: Strong verbs (Led, Implemented, Optimized, not "Responsible for")
   - **STAR Format**: Situation, Task, Action, Result
   - **Relevance**: Aligned with target role
   - **Clarity**: Clear, concise bullet points (1-2 lines each)

### Phase 2: Feedback & Recommendations

Provide structured feedback:

1. **Overall Assessment** (1-10 score with rationale)
   - ATS Compatibility: __/10
   - Content Quality: __/10
   - Structure & Format: __/10
   - Professional Impact: __/10

2. **Critical Issues** (Must Fix)
   - Missing essential sections
   - ATS-incompatible formatting
   - Lack of quantifiable achievements
   - Typos or grammatical errors
   - Outdated or irrelevant content

3. **Improvement Opportunities** (Should Fix)
   - Weak action verbs
   - Vague descriptions
   - Missing keywords
   - Inconsistent formatting
   - Poor space utilization

4. **Enhancement Suggestions** (Nice to Have)
   - Additional relevant skills
   - Project showcases
   - Leadership examples
   - Industry certifications

### Phase 3: Content Improvement

For each work experience entry, suggest improved versions:

**Before**:
```
Responsible for managing team projects and coordinating with clients.
```

**After**:
```
• Led cross-functional team of 8 engineers to deliver 15+ client projects on time, achieving 95% customer satisfaction
• Coordinated with 20+ enterprise clients, resulting in $2M+ annual contract renewals
```

**Guidelines for Improvements**:
- Start with strong action verbs
- Include specific numbers and metrics
- Show impact and results
- Use industry-standard terminology
- Keep bullet points concise (1-2 lines)

### Phase 4: Resume Generation (New Resume)

If creating a new resume from scratch:

1. **Gather Information**
   Ask the user for:
   - Personal details (name, contact, location)
   - Target role and industry
   - Work history (companies, dates, responsibilities, achievements)
   - Education background
   - Skills and certifications
   - Notable projects or accomplishments

2. **Choose Format**
   - **Chronological**: Best for steady career progression
   - **Functional**: Best for career changers or gaps
   - **Combination**: Best for experienced professionals

3. **Generate Resume Content**
   Use this structure:

```
[FULL NAME]
[Email] | [Phone] | [City, State] | [LinkedIn URL] | [Portfolio/GitHub]

PROFESSIONAL SUMMARY
[2-3 sentences highlighting years of experience, key expertise, and value proposition]

PROFESSIONAL EXPERIENCE

[Company Name] | [Location]
[Job Title] | [Month Year] - [Month Year]
• [Achievement-focused bullet point with metrics]
• [Achievement-focused bullet point with metrics]
• [Achievement-focused bullet point with metrics]

[Repeat for each role]

EDUCATION

[Degree] in [Field] | [University Name] | [Graduation Year]
• [Honors, GPA if >3.5, relevant coursework]

SKILLS

Technical: [List of relevant technical skills]
Tools: [List of relevant tools and platforms]
Soft Skills: [List of relevant soft skills]

CERTIFICATIONS (if applicable)
• [Certification Name], [Issuing Organization], [Year]
```

4. **Write to File**
   - Save as `resume_[name]_[date].txt` or `.md`
   - Use Write tool to create the file
   - Inform user they can convert to PDF/Word as needed

### Phase 5: Job-Specific Tailoring

If user has a specific job posting:

1. **Extract Job Requirements**
   - Read job description
   - Identify required skills, experience, qualifications
   - Note key terminology and phrases
   - Identify company values and culture

2. **Match Resume Content**
   - Highlight relevant experience
   - Incorporate job-specific keywords
   - Reorder bullet points for relevance
   - Add/emphasize matching skills
   - Adjust professional summary

3. **Customize Cover Letter** (if requested)
   - Reference specific job requirements
   - Connect experience to role needs
   - Show cultural fit
   - Include call-to-action

## ATS Optimization Checklist

Use this checklist for ATS compatibility:

- [ ] Simple, clean formatting (no tables, columns, graphics)
- [ ] Standard section headings (EXPERIENCE, EDUCATION, SKILLS)
- [ ] Standard fonts (Arial, Calibri, Times New Roman, 10-12pt)
- [ ] .docx or .txt file format
- [ ] No headers/footers (put contact info in body)
- [ ] No text boxes or images
- [ ] Keywords from job description included
- [ ] Consistent date formatting (MM/YYYY or Month YYYY)
- [ ] Acronyms spelled out first time (e.g., "Search Engine Optimization (SEO)")
- [ ] Standard bullet points (•, -, or ◦)
- [ ] File name format: FirstName_LastName_Resume.docx

## Common Issues & Solutions

### Issue: "Responsible for..."
**Problem**: Passive language that doesn't show impact
**Solution**: Start with action verbs and add results
```
❌ Responsible for customer support
✅ Resolved 200+ customer inquiries monthly with 98% satisfaction rating
```

### Issue: No Metrics
**Problem**: Vague, unmeasurable claims
**Solution**: Add specific numbers
```
❌ Improved team efficiency
✅ Improved team efficiency by 35% through process automation, reducing turnaround time from 5 days to 3 days
```

### Issue: Too Long or Too Short
**Problem**: Resume length not appropriate for experience level
**Solution**:
- Entry-level (0-5 years): 1 page
- Mid-level (5-10 years): 1-2 pages
- Senior-level (10+ years): 2 pages maximum

### Issue: Outdated Skills
**Problem**: Lists irrelevant or outdated technologies
**Solution**: Focus on current, in-demand skills for target role

### Issue: Employment Gaps
**Problem**: Unexplained gaps in work history
**Solution**:
- Use years instead of months if gap is small
- Include relevant activities (freelance, courses, volunteering)
- Address positively in cover letter if needed

## Industry-Specific Guidance

### Tech/Engineering
- Emphasize: Technical skills, programming languages, frameworks, projects
- Include: GitHub/portfolio links, open-source contributions
- Format: Clean, modern, data-driven
- Keywords: Agile, CI/CD, APIs, cloud platforms, version control

### Business/Finance
- Emphasize: Results, revenue impact, cost savings, strategic initiatives
- Include: Certifications (CPA, CFA, MBA), leadership experience
- Format: Professional, conservative
- Keywords: P&L, ROI, stakeholder management, financial modeling

### Creative/Design
- Emphasize: Portfolio, design process, tools, creative achievements
- Include: Portfolio link prominently, design awards
- Format: Can be more creative but still ATS-friendly
- Keywords: UX/UI, Adobe Creative Suite, design thinking, user research

### Healthcare
- Emphasize: Certifications, patient care, compliance, specialized skills
- Include: Licenses, credentials, patient outcomes
- Format: Professional, detail-oriented
- Keywords: EMR systems, HIPAA, patient-centered care, clinical protocols

### Marketing/Sales
- Emphasize: Campaign results, growth metrics, brand awareness, revenue
- Include: Successful campaigns, client portfolios, certifications
- Format: Results-driven, dynamic
- Keywords: ROI, lead generation, conversion rates, digital marketing, CRM

## Examples

### Example 1: Software Engineer

**Before**:
```
Software Developer at TechCorp (2020-2023)
- Wrote code for various projects
- Fixed bugs
- Worked with team members
```

**After**:
```
Software Engineer | TechCorp | San Francisco, CA | Jan 2020 - Dec 2023
• Architected and deployed 12+ microservices handling 10M+ daily requests with 99.9% uptime
• Reduced application load time by 40% through code optimization and caching strategies
• Mentored 5 junior developers, conducting code reviews and technical workshops
• Technologies: Python, Django, PostgreSQL, Redis, AWS, Docker, Kubernetes
```

### Example 2: Marketing Manager

**Before**:
```
Marketing Manager at StartupXYZ (2019-2023)
- Managed marketing campaigns
- Worked on social media
- Helped increase brand awareness
```

**After**:
```
Marketing Manager | StartupXYZ | Austin, TX | Mar 2019 - Present
• Drove 250% increase in qualified leads through multi-channel campaigns, generating $5M in pipeline
• Managed $500K annual marketing budget, optimizing spend to achieve 35% reduction in CAC
• Built marketing team from 2 to 8 members, establishing processes and campaign frameworks
• Increased social media engagement by 180% across LinkedIn, Twitter, and Facebook platforms
```

### Example 3: Project Manager

**Before**:
```
Project Manager at ConsultCo (2018-2023)
- Managed client projects
- Coordinated with teams
- Delivered projects on time
```

**After**:
```
Senior Project Manager | ConsultCo | Chicago, IL | Jun 2018 - Aug 2023
• Led 25+ enterprise consulting engagements ($100K-$2M each) for Fortune 500 clients with 100% on-time delivery
• Managed cross-functional teams of 15+ consultants across 3 time zones, delivering complex digital transformation projects
• Improved client satisfaction scores from 7.2 to 9.1/10 through proactive communication and risk management
• Achieved 98% project profitability rate by implementing agile methodologies and resource optimization
```

## Key Reminders

1. **Quantify Everything**: Numbers, percentages, dollar amounts, timeframes
2. **Be Specific**: Replace vague terms with concrete examples
3. **Show Impact**: Focus on results, not just responsibilities
4. **Use Keywords**: Match language from job descriptions
5. **Keep it Current**: Remove outdated skills and old experiences (>10-15 years)
6. **Proofread Thoroughly**: No typos, consistent formatting, proper grammar
7. **Optimize for ATS**: Simple format, standard headings, keyword-rich
8. **Tell a Story**: Show career progression and growth
9. **Be Honest**: Never fabricate experience or qualifications
10. **Keep it Concise**: Every word should add value

## Resources to Reference

- **Action Verbs List**: Achieved, Accelerated, Accomplished, Administered, Analyzed, Architected, Built, Championed, Collaborated, Coordinated, Created, Delivered, Demonstrated, Designed, Developed, Drove, Enhanced, Established, Exceeded, Executed, Expanded, Generated, Implemented, Improved, Increased, Initiated, Launched, Led, Managed, Maximized, Optimized, Orchestrated, Organized, Pioneered, Reduced, Resolved, Spearheaded, Streamlined, Strengthened, Transformed

- **Metrics to Include**:
  - Percentages (increased by X%)
  - Dollar amounts ($X revenue, $Y budget)
  - Time saved (reduced from X to Y)
  - Team size (managed X people)
  - Customer/user counts (served X customers)
  - Project counts (delivered X projects)
  - Quality metrics (98% satisfaction, 99.9% uptime)

---

## Final Output Format

Always provide:
1. **Analysis Summary** (if reviewing existing resume)
2. **Scored Assessment** (ATS, Content, Structure, Impact)
3. **Prioritized Recommendations** (Critical, Important, Enhancement)
4. **Specific Improvements** (before/after examples)
5. **Updated Resume Draft** (if requested)
6. **Next Steps** (actions user should take)
