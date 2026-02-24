# Incident Response Plan

**Sobojinski Solutions — EMR OS**
**HIPAA Security Incident Response Plan**

> **IMPORTANT NOTICE:** This document is a template and operational guide provided for informational purposes. It must be reviewed and customized by qualified legal counsel and information security professionals before adoption. Organizations must ensure this plan meets all applicable federal, state, and local requirements, including but not limited to HIPAA, HITECH, and state breach notification laws.

---

**Document Control**

| Field | Value |
|---|---|
| Document Title | HIPAA Security Incident Response Plan |
| Organization | Sobojinski Solutions, LLC |
| Product | EMR OS — Physical Therapy EMR Platform |
| Version | 1.0 |
| Classification | Confidential — Internal Use Only |
| Last Updated | [Date] |
| Approved By | [Name, Title] |
| Next Review Date | [Date — recommend annual review] |

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Scope](#2-scope)
3. [Regulatory Framework](#3-regulatory-framework)
4. [Roles and Responsibilities](#4-roles--responsibilities)
5. [Incident Classification](#5-incident-classification)
6. [Response Phases](#6-response-phases)
7. [HIPAA Breach Notification Requirements](#7-hipaa-breach-notification-requirements)
8. [Evidence Preservation and Documentation](#8-evidence-preservation-and-documentation)
9. [Emergency Contact List](#9-emergency-contact-list)
10. [Tabletop Exercise Schedule](#10-tabletop-exercise-schedule)
11. [Plan Maintenance](#11-plan-maintenance)
12. [Appendices](#12-appendices)

---

## 1. Purpose

The purpose of this Incident Response Plan ("IRP" or "Plan") is to establish a structured, repeatable process for identifying, responding to, containing, eradicating, and recovering from security incidents affecting the EMR OS platform and any Protected Health Information ("PHI") processed, stored, or transmitted by Sobojinski Solutions on behalf of its clients.

This Plan ensures that Sobojinski Solutions meets its obligations under:

- The HIPAA Security Rule (45 CFR 164.308(a)(6) — Security Incident Procedures)
- The HIPAA Breach Notification Rule (45 CFR 164 Subpart D)
- The HITECH Act (42 U.S.C. 17931 et seq.)
- Applicable state data breach notification laws
- Contractual obligations under Business Associate Agreements with Covered Entity clients

The goals of this Plan are to:

- Minimize the impact of security incidents on patients, clients, and the organization
- Ensure timely and compliant breach notifications
- Preserve evidence for forensic analysis and potential legal proceedings
- Restore normal operations as quickly as possible
- Identify root causes and implement measures to prevent recurrence
- Maintain the trust and confidence of clients and their patients

---

## 2. Scope

### 2.1 Systems in Scope

This Plan covers all systems, networks, applications, and data repositories that create, receive, maintain, or transmit PHI in connection with the EMR OS platform, including but not limited to:

- EMR OS production application servers and databases
- Staging and development environments that contain PHI or production-equivalent data
- Cloud infrastructure (compute, storage, networking, identity management)
- Backup and disaster recovery systems
- Administrative and management interfaces
- API endpoints and integrations with third-party systems
- Employee and contractor workstations used to access PHI
- Mobile devices used to access EMR OS systems
- Communication systems used to transmit PHI (email, messaging)

### 2.2 Incident Types in Scope

- Unauthorized access to systems containing PHI
- Unauthorized disclosure of PHI (electronic or physical)
- Loss or theft of devices or media containing PHI
- Malware, ransomware, or other malicious software infections
- Denial-of-service attacks affecting PHI availability
- Exploitation of system vulnerabilities
- Insider threats (intentional or accidental)
- Social engineering attacks (phishing, pretexting)
- Physical security breaches affecting PHI
- Vendor or subcontractor security incidents affecting PHI
- Accidental exposure of PHI (misconfiguration, misdirected communications)

### 2.3 Personnel in Scope

This Plan applies to all Sobojinski Solutions employees, contractors, temporary workers, and third-party service providers who have access to EMR OS systems or PHI.

---

## 3. Regulatory Framework

This Plan is designed to satisfy the following regulatory requirements:

| Regulation | Section | Requirement |
|---|---|---|
| HIPAA Security Rule | 45 CFR 164.308(a)(6)(i) | Security Incident Procedures — implement policies and procedures to address security incidents |
| HIPAA Security Rule | 45 CFR 164.308(a)(6)(ii) | Response and Reporting — identify and respond to suspected or known security incidents; mitigate harmful effects; document incidents and outcomes |
| HIPAA Breach Notification Rule | 45 CFR 164.410 | Notification by a Business Associate — notify Covered Entity of Breach of Unsecured PHI |
| HIPAA Breach Notification Rule | 45 CFR 164.402 | Breach definition and risk assessment criteria |
| HIPAA Breach Notification Rule | 45 CFR 164.404 | Individual notification requirements (60 days) |
| HIPAA Breach Notification Rule | 45 CFR 164.406 | HHS notification requirements |
| HIPAA Breach Notification Rule | 45 CFR 164.408 | Media notification requirements (500+ individuals in a state/jurisdiction) |
| HITECH Act | 42 U.S.C. 17932 | Notification in the case of breach |
| HIPAA Security Rule | 45 CFR 164.312(b) | Audit controls — hardware, software, and procedural mechanisms to record and examine access |
| HIPAA Security Rule | 45 CFR 164.316 | Documentation — maintain policies, procedures, and records of actions, activities, or assessments |

---

## 4. Roles & Responsibilities

### 4.1 Incident Response Team Structure

The Incident Response Team ("IRT") is activated upon classification of a Severity 1 or Severity 2 incident, or at the discretion of the Security Officer for lower-severity incidents.

#### Incident Commander (IC)

**Assigned to:** [Name, Title]
**Backup:** [Name, Title]

Responsibilities:
- Serve as the single point of authority during incident response
- Coordinate all response activities across functional areas
- Make critical decisions regarding containment, communication, and escalation
- Authorize resource allocation for response efforts
- Approve external communications and notifications
- Conduct or delegate post-incident review
- Report to executive leadership on incident status and resolution

#### Security Officer / HIPAA Security Officer

**Assigned to:** [Name, Title]
**Backup:** [Name, Title]

Responsibilities:
- Serve as the primary technical lead for incident investigation
- Perform initial triage and classification of reported incidents
- Direct forensic analysis and evidence collection
- Determine whether PHI has been compromised
- Conduct the four-factor Breach risk assessment per 45 CFR 164.402(2)
- Coordinate with external forensic investigators when necessary
- Maintain the incident response toolkit and forensic tools
- Ensure audit logs and evidence are preserved
- Recommend containment, eradication, and recovery actions

#### HIPAA Privacy Officer

**Assigned to:** [Name, Title]
**Backup:** [Name, Title]

Responsibilities:
- Assess incidents for HIPAA Privacy Rule implications
- Determine whether a Breach of Unsecured PHI has occurred
- Coordinate breach notification obligations with affected Covered Entities
- Ensure compliance with individual, HHS, and media notification requirements
- Maintain the Breach notification log and documentation
- Advise on privacy-related regulatory and contractual obligations
- Serve as liaison with HHS Office for Civil Rights (OCR) if applicable

#### Communications Lead

**Assigned to:** [Name, Title]
**Backup:** [Name, Title]

Responsibilities:
- Draft and coordinate all internal and external communications
- Manage notifications to affected Covered Entity clients
- Coordinate media inquiries and public statements (if applicable)
- Prepare patient notification letters and substitute notices (in coordination with Covered Entities)
- Maintain communication logs and records
- Manage the incident communication hotline or email address
- Coordinate with legal counsel on communication content

#### Technical Response Lead

**Assigned to:** [Name, Title]
**Backup:** [Name, Title]

Responsibilities:
- Execute technical containment and eradication measures
- Coordinate system recovery and restoration activities
- Implement emergency patches, configuration changes, and access revocations
- Monitor systems during and after incident for signs of continued compromise
- Provide technical findings and timelines to the Security Officer
- Assist with evidence preservation and forensic imaging

#### Legal Counsel

**Assigned to:** [Name/Firm, Contact Information]

Responsibilities:
- Advise on legal obligations, including breach notification requirements
- Review external communications and notifications for legal sufficiency
- Assess litigation risk and advise on privilege and evidence preservation
- Interface with law enforcement when appropriate
- Advise on regulatory reporting obligations under state and federal law
- Review and update contractual breach notification provisions

### 4.2 All Employees

All Sobojinski Solutions personnel are responsible for:

- Immediately reporting suspected security incidents to the Security Officer
- Preserving evidence and refraining from altering affected systems
- Cooperating fully with the Incident Response Team
- Maintaining confidentiality of incident information
- Following instructions issued by the Incident Commander

**Reporting Channel:** All suspected incidents must be reported to:
- Email: [security@sobojinski.com]
- Phone: [Incident Hotline Number]
- Internal Ticketing System: [URL/System Name]

---

## 5. Incident Classification

All reported security events shall be classified according to the following severity levels. Classification determines the scope of the response, the personnel involved, and the escalation timeline.

### Severity 1 — Critical

**Definition:** Confirmed breach or compromise involving PHI; active unauthorized access to production systems; ransomware or destructive malware in production; complete loss of service availability for PHI systems.

**Examples:**
- Confirmed exfiltration of patient data from EMR OS databases
- Ransomware encryption of production databases containing PHI
- Unauthorized administrative access to production infrastructure
- Complete outage of EMR OS production environment for extended period
- Loss or theft of unencrypted media containing PHI

**Response Requirements:**
- Activate full Incident Response Team immediately
- Incident Commander assumes command within 30 minutes of classification
- Begin containment actions within 1 hour
- Initial status report to executive leadership within 2 hours
- Continuous monitoring and status updates every 2 hours
- Legal counsel engaged immediately
- Affected Covered Entities notified within 24 hours of classification (or per BAA terms)
- Post-incident review within 5 business days of resolution

### Severity 2 — High

**Definition:** Suspected breach involving PHI; significant unauthorized access attempt; vulnerability exploitation affecting PHI systems; service degradation affecting PHI availability.

**Examples:**
- Successful phishing attack compromising credentials with PHI access
- Detection of malware on systems with access to PHI
- Exploitation of a known vulnerability in EMR OS infrastructure
- Unauthorized access to non-production environments containing PHI-equivalent data
- Extended partial outage of PHI-related systems

**Response Requirements:**
- Activate Incident Response Team within 1 hour
- Incident Commander assumes command within 2 hours
- Begin containment actions within 2 hours
- Initial status report to executive leadership within 4 hours
- Status updates every 4 hours
- Legal counsel notified within 4 hours
- Breach risk assessment initiated within 24 hours
- Post-incident review within 10 business days of resolution

### Severity 3 — Medium

**Definition:** Security event with potential but unconfirmed impact on PHI; failed intrusion attempts with indicators of targeted attack; policy violations involving PHI handling.

**Examples:**
- Multiple failed authentication attempts against PHI systems from a single source
- Employee policy violation in PHI handling (not resulting in confirmed disclosure)
- Detection of reconnaissance activity against EMR OS infrastructure
- Minor misconfiguration discovered in PHI access controls (no confirmed exposure)
- Vulnerability discovered in production system (not yet exploited)

**Response Requirements:**
- Security Officer assesses and responds within 4 hours
- Incident Commander notified within 8 hours
- Containment actions as determined by Security Officer
- Status updates daily until resolution
- Breach risk assessment if PHI exposure is suspected
- Post-incident review within 15 business days of resolution

### Severity 4 — Low

**Definition:** Security event with no direct impact on PHI; routine security alerts; minor policy deviations; informational events that warrant documentation.

**Examples:**
- Routine failed login attempts (non-targeted)
- Blocked malware detection on non-PHI systems
- Minor policy deviation with no PHI impact
- Non-critical software vulnerability in non-PHI systems
- Spam or phishing attempts blocked by automated controls

**Response Requirements:**
- Security Officer reviews within 1 business day
- Documented in incident tracking system
- Addressed through normal operational procedures
- Aggregated and reviewed in monthly security review
- Escalated if pattern suggests higher-severity activity

---

## 6. Response Phases

### Phase 1 — Detection and Identification

**Objective:** Detect the security event, perform initial assessment, and classify the incident.

**Activities:**

1. **Event Detection**
   - Monitor automated alerting systems (SIEM, IDS/IPS, log aggregation, endpoint detection)
   - Receive and process reports from employees, clients, or external parties
   - Review anomalous activity flagged by audit log review processes

2. **Initial Triage**
   - Security Officer (or designee) performs preliminary assessment within 30 minutes of receiving the report
   - Determine whether the event constitutes a security incident
   - Collect initial information: what happened, when, what systems and data may be affected
   - Document initial findings in the incident tracking system

3. **Classification**
   - Assign severity level (1-4) based on criteria in Section 5
   - Determine whether PHI is potentially involved
   - Identify the incident type (unauthorized access, malware, data loss, etc.)

4. **Notification and Activation**
   - Notify the Incident Commander per the escalation timelines in Section 5
   - Activate the Incident Response Team as required by the severity level
   - Assign an incident tracking number and open a formal incident record
   - Establish a dedicated communication channel for the response team

**Key Documentation:**
- Incident report form (who reported, when, initial description)
- Preliminary assessment and classification rationale
- Notification and activation timestamps

---

### Phase 2 — Containment

**Objective:** Limit the scope and impact of the incident; prevent further unauthorized access, disclosure, or damage.

**Activities:**

1. **Short-Term Containment** (Immediate)
   - Isolate affected systems from the network (if necessary and if impact is acceptable)
   - Disable compromised user accounts and revoke access tokens
   - Block malicious IP addresses, domains, or network traffic
   - Implement emergency firewall rules or access control changes
   - Activate backup communication channels if primary channels are compromised
   - Preserve volatile evidence (memory dumps, running processes) before changes are made

2. **Long-Term Containment** (Sustained)
   - Apply temporary patches or configuration changes to prevent re-exploitation
   - Redirect traffic from compromised systems to clean systems
   - Implement enhanced monitoring on affected and adjacent systems
   - Establish clean staging environments for system restoration
   - Ensure backup integrity for affected systems

3. **Decision Points**
   - Assess whether systems must be taken offline (impact on client operations vs. security risk)
   - Determine whether law enforcement notification is appropriate
   - Evaluate whether Covered Entity clients must be notified during containment (per BAA obligations)
   - Assess whether external forensic support is required

**Key Documentation:**
- Containment actions taken, with timestamps
- Justification for each containment decision
- Impact assessment of containment actions on operations
- Evidence preservation log

---

### Phase 3 — Eradication

**Objective:** Remove the root cause of the incident and eliminate the threat from all affected systems.

**Activities:**

1. **Root Cause Analysis**
   - Identify the attack vector and method of compromise
   - Determine the full scope of affected systems, accounts, and data
   - Analyze forensic evidence (logs, disk images, memory captures, network traffic)
   - Identify any backdoors, persistence mechanisms, or secondary compromise

2. **Threat Removal**
   - Remove malware, unauthorized accounts, and malicious files
   - Close exploited vulnerabilities (apply patches, update configurations)
   - Rebuild compromised systems from known-clean sources (preferred over cleaning)
   - Rotate all potentially compromised credentials, keys, and certificates
   - Revoke and re-issue API keys and access tokens
   - Update firewall rules, access control lists, and security group configurations

3. **Verification**
   - Scan remediated systems for residual indicators of compromise
   - Review logs to confirm threat activity has ceased
   - Validate that all identified vulnerabilities have been addressed
   - Conduct targeted penetration testing of remediated attack vectors (if applicable)

**Key Documentation:**
- Root cause analysis findings
- Complete inventory of affected systems, accounts, and data
- Remediation actions taken with timestamps
- Verification results

---

### Phase 4 — Recovery

**Objective:** Restore affected systems to normal operation and confirm that the threat has been eliminated.

**Activities:**

1. **System Restoration**
   - Restore systems from verified clean backups or rebuild from known-good configurations
   - Re-deploy applications from validated source code and build artifacts
   - Restore data from verified, uncompromised backups
   - Apply all current security patches and hardening configurations
   - Reset user credentials and restore access controls

2. **Validation**
   - Perform functional testing to confirm systems are operating correctly
   - Execute security testing to confirm vulnerabilities have been remediated
   - Verify data integrity for restored databases and files
   - Confirm audit logging is functioning correctly on restored systems
   - Validate backup processes are operational

3. **Phased Return to Operations**
   - Restore services incrementally, starting with least-critical systems
   - Implement enhanced monitoring during the recovery period (minimum 30 days)
   - Establish specific indicators to watch for re-compromise
   - Notify clients of service restoration and any required actions on their part

4. **Client Communication**
   - Provide affected Covered Entity clients with a summary of the incident and recovery actions
   - Coordinate with clients on any actions they need to take (e.g., password resets for their users)
   - Provide status updates on the recovery timeline

**Key Documentation:**
- Restoration procedures and verification results
- System validation test results
- Enhanced monitoring configuration
- Client notification records

---

### Phase 5 — Post-Incident Review

**Objective:** Analyze the incident to identify lessons learned and improve future incident response capabilities.

**Activities:**

1. **Post-Incident Review Meeting** (within timeline specified in Section 5)
   - Convene all Incident Response Team members and relevant stakeholders
   - Review the complete incident timeline from detection through recovery
   - Identify what went well and what could be improved
   - Document root cause(s) and contributing factors

2. **Breach Determination** (if not already completed)
   - Conduct or finalize the four-factor risk assessment per 45 CFR 164.402(2)
   - Make formal determination of whether a Breach of Unsecured PHI occurred
   - Document the risk assessment rationale and conclusion
   - If a Breach is determined, initiate notification procedures per Section 7

3. **Corrective Actions**
   - Develop a corrective action plan with specific, measurable items
   - Assign owners and deadlines for each corrective action
   - Prioritize actions based on risk and feasibility
   - Track corrective actions to completion

4. **Plan Updates**
   - Update this Incident Response Plan based on lessons learned
   - Update related security policies, procedures, and configurations
   - Update training materials to address identified gaps
   - Update risk assessment and risk register

5. **Reporting**
   - Prepare a final incident report for executive leadership
   - Prepare client-facing incident summary (as appropriate)
   - File regulatory reports as required (Section 7)
   - Update the incident log with final disposition

**Key Documentation:**
- Post-incident review meeting minutes
- Breach risk assessment and determination
- Final incident report
- Corrective action plan with owner assignments and deadlines
- Updated policies, procedures, and plan revisions

---

## 7. HIPAA Breach Notification Requirements

### 7.1 Breach Determination

A Breach is presumed to have occurred upon any acquisition, access, use, or disclosure of PHI not permitted under the HIPAA Privacy Rule, unless the organization demonstrates through a risk assessment that there is a low probability that the PHI has been compromised, based on the following four factors (45 CFR 164.402(2)):

1. **The nature and extent of the PHI involved**, including the types of identifiers and the likelihood of re-identification
2. **The unauthorized person who used the PHI or to whom the disclosure was made**
3. **Whether the PHI was actually acquired or viewed**
4. **The extent to which the risk to the PHI has been mitigated**

The following are excluded from the definition of Breach (45 CFR 164.402(1)):

- Unintentional acquisition, access, or use of PHI by a workforce member acting in good faith and within the scope of authority, provided the information is not further used or disclosed impermissibly
- Inadvertent disclosure by an authorized person to another authorized person within the same organization, provided the information is not further used or disclosed impermissibly
- A disclosure where the organization has a good faith belief that the unauthorized person to whom the disclosure was made would not reasonably have been able to retain the information

### 7.2 Notification to Covered Entity Clients

As a Business Associate, Sobojinski Solutions must notify affected Covered Entity clients of a Breach of Unsecured PHI without unreasonable delay and in no case later than the timeframe specified in the applicable Business Associate Agreement (typically 30 calendar days, per 45 CFR 164.410).

The notification must include:

- Identification of each Individual whose PHI has been or is reasonably believed to have been compromised
- A description of what happened, including the date of the Breach and date of discovery
- A description of the types of PHI involved
- Any steps Individuals should take to protect themselves
- A description of what Sobojinski Solutions is doing to investigate, mitigate harm, and prevent recurrence
- Contact information for questions

### 7.3 Individual Notification (Covered Entity Responsibility — Supported by Sobojinski Solutions)

Under 45 CFR 164.404, the Covered Entity is responsible for providing individual notifications. Sobojinski Solutions will support this process by:

**Timeline:** No later than 60 calendar days after discovery of the Breach.

**Method:**
- Written notice to the last known address of each affected Individual
- If the Covered Entity has insufficient or out-of-date contact information for 10 or more Individuals: conspicuous posting on the Covered Entity's website for at least 90 days, OR conspicuous notice in major print or broadcast media in the affected area, including a toll-free phone number active for at least 90 days
- If urgency requires, telephone or other means of notification in addition to written notice

**Content (per 45 CFR 164.404(c)):**
- A brief description of the Breach, including dates
- A description of the types of PHI involved
- Steps Individuals should take to protect themselves
- A description of investigation and mitigation efforts
- Contact information (toll-free phone number, email, website, or postal address)

### 7.4 HHS Notification

Under 45 CFR 164.408, the Covered Entity must notify the Secretary of HHS:

- **500 or more Individuals affected:** Notification without unreasonable delay, and no later than 60 days after discovery. Submit via the HHS Breach Reporting Portal at [https://ocrportal.hhs.gov/ocr/breach/wizard_breach.jsf](https://ocrportal.hhs.gov/ocr/breach/wizard_breach.jsf). Breaches affecting 500 or more individuals are posted on the HHS "Wall of Shame" (Breach Portal).

- **Fewer than 500 Individuals affected:** Notification no later than 60 days after the end of the calendar year in which the Breach was discovered. Submit via the same HHS Breach Reporting Portal.

### 7.5 Media Notification

Under 45 CFR 164.406, if a Breach affects 500 or more Individuals in a single state or jurisdiction:

- The Covered Entity must provide notice to prominent media outlets serving the state or jurisdiction
- Notice must be provided without unreasonable delay and no later than 60 days after discovery
- Content requirements are the same as individual notification

Sobojinski Solutions will assist affected Covered Entities with media notification preparation and coordination.

### 7.6 State Breach Notification Laws

Many states have breach notification laws with requirements that may exceed HIPAA requirements (e.g., shorter notification timelines, broader definitions of personal information, attorney general notification). Sobojinski Solutions will:

- Maintain awareness of applicable state breach notification laws
- Coordinate with legal counsel to identify state-specific obligations
- Assist Covered Entities in meeting state notification requirements

### 7.7 Law Enforcement Delay

Notification may be delayed if a law enforcement official provides a written statement that notification would impede a criminal investigation or cause damage to national security, or if an oral statement is made, notification may be delayed for no more than 30 days (45 CFR 164.412).

---

## 8. Evidence Preservation and Documentation

### 8.1 Evidence Handling Principles

- Preserve the integrity of all evidence from the moment an incident is detected
- Maintain a documented chain of custody for all evidence
- Use forensically sound methods for evidence collection (write-blockers, verified imaging tools)
- Store evidence in secure, access-controlled locations
- Retain evidence for a minimum of six (6) years, consistent with HIPAA documentation requirements (45 CFR 164.530(j))

### 8.2 Types of Evidence to Preserve

- System and application logs (authentication, access, error, audit)
- Network traffic captures and flow data
- Disk images and memory dumps of affected systems
- Malware samples
- Email messages and attachments related to the incident
- Screenshots and photographs
- Incident response notes and communications
- Backup media from the time of the incident

### 8.3 Incident Documentation Requirements

Every incident, regardless of severity, must be documented in the incident tracking system with:

- Unique incident identifier
- Date and time of detection and reporting
- Person(s) who detected and reported the incident
- Classification and severity level
- Description of the incident
- Systems, data, and individuals affected
- Containment, eradication, and recovery actions taken (with timestamps)
- Breach risk assessment and determination (if applicable)
- Notifications issued (with dates and recipients)
- Root cause and contributing factors
- Corrective actions and status
- Final disposition and closure date

---

## 9. Emergency Contact List

> **NOTE:** This contact list must be kept current at all times. Review and update at least quarterly. Distribute to all Incident Response Team members and store in multiple accessible locations (including offline/printed copies).

### 9.1 Internal Contacts — Incident Response Team

| Role | Primary | Phone | Email | Backup | Phone | Email |
|---|---|---|---|---|---|---|
| Incident Commander | [Name] | [Phone] | [Email] | [Name] | [Phone] | [Email] |
| Security Officer | [Name] | [Phone] | [Email] | [Name] | [Phone] | [Email] |
| Privacy Officer | [Name] | [Phone] | [Email] | [Name] | [Phone] | [Email] |
| Communications Lead | [Name] | [Phone] | [Email] | [Name] | [Phone] | [Email] |
| Technical Response Lead | [Name] | [Phone] | [Email] | [Name] | [Phone] | [Email] |
| CEO / Executive Sponsor | [Name] | [Phone] | [Email] | — | — | — |

### 9.2 External Contacts

| Organization | Contact | Phone | Email / URL | Purpose |
|---|---|---|---|---|
| Legal Counsel | [Firm/Attorney Name] | [Phone] | [Email] | Legal advice, breach assessment |
| Cyber Insurance Carrier | [Company Name] | [Claims Phone] | [Claims Email] | Incident coverage, forensic vendor approval |
| External Forensics Firm | [Company Name] | [Phone] | [Email] | Forensic investigation |
| Cloud Provider (Security) | [Provider Name — e.g., AWS] | [Support Phone] | [Security Portal URL] | Infrastructure incidents |
| FBI — Cyber Division | Local Field Office | [Phone] | [ic3.gov](https://ic3.gov) | Law enforcement (cyber crimes) |
| HHS Office for Civil Rights | — | 1-800-368-1019 | [ocrportal.hhs.gov](https://ocrportal.hhs.gov) | HIPAA breach reporting |
| State Attorney General | [State AG Office] | [Phone] | [Website] | State breach notification |

### 9.3 Client Notification Contacts

Maintain a current list of primary and secondary contacts for each Covered Entity client, including:

- Client organization name
- Primary privacy/security contact name, phone, email
- Secondary contact name, phone, email
- BAA reference number
- Preferred notification method

*This list is maintained separately in [Location — e.g., encrypted client contact database] and updated with each new client onboarding and quarterly thereafter.*

---

## 10. Tabletop Exercise Schedule

### 10.1 Purpose

Tabletop exercises validate the effectiveness of this Incident Response Plan, train personnel on their roles and responsibilities, and identify areas for improvement. HIPAA requires ongoing security awareness and training (45 CFR 164.308(a)(5)), and regular incident response exercises are an industry best practice.

### 10.2 Exercise Schedule

| Exercise | Frequency | Participants | Duration | Owner |
|---|---|---|---|---|
| Full IRP Tabletop — Severity 1 (Breach Scenario) | Semi-annually | Full IRT, Executive Leadership, Legal Counsel | 2-3 hours | Security Officer |
| Focused Tabletop — Ransomware Scenario | Annually | IRT, Technical Staff | 2 hours | Technical Response Lead |
| Focused Tabletop — Insider Threat Scenario | Annually | IRT, HR, Legal | 2 hours | Privacy Officer |
| Focused Tabletop — Vendor Compromise Scenario | Annually | IRT, Vendor Management | 1.5 hours | Security Officer |
| Breach Notification Walkthrough | Annually | Privacy Officer, Communications Lead, Legal Counsel | 1.5 hours | Privacy Officer |
| Technical Incident Drill (Live) | Quarterly | Technical Response Team | 1-2 hours | Technical Response Lead |
| New Employee IRP Orientation | Upon hire | New hires with PHI access | 30 minutes | Security Officer |

### 10.3 Exercise Methodology

Each tabletop exercise shall follow this format:

1. **Preparation** (1-2 weeks prior)
   - Develop scenario narrative and injects
   - Distribute pre-read materials and relevant plan sections
   - Confirm participant availability
   - Prepare facilitation guide and evaluation criteria

2. **Execution**
   - Facilitator presents the scenario in phases with escalating injects
   - Participants discuss response actions based on their roles
   - Facilitator captures decisions, questions, and areas of confusion
   - No-fault environment — focus on process, not blame

3. **Debrief** (immediately following)
   - Review key decisions and actions
   - Identify what worked well
   - Identify gaps, ambiguities, or areas for improvement
   - Collect participant feedback

4. **After-Action Report** (within 10 business days)
   - Document findings and recommendations
   - Assign corrective actions with owners and deadlines
   - Update the IRP and related procedures as needed
   - Distribute report to participants and executive leadership

### 10.4 Exercise Record

| Date | Exercise Type | Scenario | Participants | Key Findings | Corrective Actions | Status |
|---|---|---|---|---|---|---|
| [Date] | [Type] | [Brief Description] | [Count/Names] | [Summary] | [Actions] | [Open/Closed] |

---

## 11. Plan Maintenance

### 11.1 Review Schedule

| Activity | Frequency | Responsible Party |
|---|---|---|
| Full Plan Review and Update | Annually (minimum) | Security Officer |
| Contact List Verification | Quarterly | Security Officer |
| Post-Incident Plan Updates | After every Severity 1 or 2 incident | Incident Commander |
| Post-Exercise Plan Updates | After each tabletop exercise | Security Officer |
| Regulatory Change Review | As needed (upon new regulations or guidance) | Privacy Officer, Legal Counsel |

### 11.2 Version History

| Version | Date | Author | Description of Changes |
|---|---|---|---|
| 1.0 | [Date] | [Author] | Initial document creation |

### 11.3 Distribution

This Plan shall be distributed to:

- All Incident Response Team members (primary and backup)
- Executive leadership
- Legal counsel
- IT/Engineering staff with incident response responsibilities

Copies shall be maintained in the following locations:

- [Internal documentation system / wiki URL]
- [Encrypted offline copy location]
- [Printed copy location for offline access during outages]

---

## 12. Appendices

### Appendix A — Incident Report Form Template

```
INCIDENT REPORT FORM — SOBOJINSKI SOLUTIONS / EMR OS

Incident ID:           ___________________________
Date/Time Reported:    ___________________________
Reported By:           ___________________________
Contact Information:   ___________________________

INITIAL ASSESSMENT
Date/Time of Event:    ___________________________
Date/Time Discovered:  ___________________________
How Discovered:        [ ] Automated Alert  [ ] Employee Report
                       [ ] Client Report    [ ] External Report
                       [ ] Other: ___________

Description of Event:
_____________________________________________________________
_____________________________________________________________

Systems Affected:
_____________________________________________________________

Is PHI Potentially Involved?  [ ] Yes  [ ] No  [ ] Unknown
If Yes, Estimated Number of Individuals: ___________________
Types of PHI Potentially Involved:
[ ] Names           [ ] SSN            [ ] Dates of Birth
[ ] Addresses       [ ] Phone Numbers  [ ] Email Addresses
[ ] Medical Records [ ] Insurance Info  [ ] Financial Info
[ ] Other: ___________

CLASSIFICATION
Severity Level:  [ ] 1-Critical  [ ] 2-High  [ ] 3-Medium  [ ] 4-Low
Incident Type:   ___________________________
Classified By:   ___________________________
Date/Time:       ___________________________

ESCALATION
Incident Commander Notified:  [ ] Yes  Date/Time: ___________
IRT Activated:                [ ] Yes  Date/Time: ___________
Legal Counsel Notified:       [ ] Yes  Date/Time: ___________
Covered Entities Notified:    [ ] Yes  Date/Time: ___________
```

### Appendix B — Breach Risk Assessment Worksheet

```
BREACH RISK ASSESSMENT — 45 CFR 164.402(2)

Incident ID: ___________________________
Assessor:    ___________________________
Date:        ___________________________

FACTOR 1: Nature and Extent of PHI Involved
Types of identifiers involved: ________________________________
Likelihood of re-identification:  [ ] High  [ ] Medium  [ ] Low
Sensitivity of the PHI:          [ ] High  [ ] Medium  [ ] Low
Number of individuals affected:  ___________________________
Analysis: ____________________________________________________

FACTOR 2: Unauthorized Person
Who accessed/received the PHI?  ______________________________
Is the person a covered entity or business associate?  [ ] Yes  [ ] No
Does the person have independent obligations to protect PHI?  [ ] Yes  [ ] No
Analysis: ____________________________________________________

FACTOR 3: Whether PHI Was Actually Acquired or Viewed
Was the PHI actually acquired or viewed?  [ ] Yes  [ ] No  [ ] Unknown
What is the evidence?  _______________________________________
Analysis: ____________________________________________________

FACTOR 4: Extent to Which Risk Has Been Mitigated
Mitigation steps taken: ______________________________________
Assurances obtained from recipient (if applicable): __________
Was PHI returned or destroyed?  [ ] Yes  [ ] No  [ ] N/A
Analysis: ____________________________________________________

OVERALL DETERMINATION
[ ] Breach — There is MORE than a low probability that PHI was compromised
[ ] Not a Breach — There is a LOW probability that PHI was compromised
[ ] Not a Breach — Exclusion applies (specify): ______________

Rationale: ___________________________________________________
_____________________________________________________________

Approved By: _________________________ Date: ________________
```

---

*Document Version: 1.0*
*Last Updated: [Date]*
*Prepared by Sobojinski Solutions for EMR OS operations.*
*This document requires review and approval by qualified legal counsel and information security professionals prior to adoption.*
