export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      attendance_plans: {
        Row: {
          goal: number
          notes: string | null
          plan: string | null
          schedule: Json
          student_id: string
          updated_at: string
        }
        Insert: {
          goal?: number
          notes?: string | null
          plan?: string | null
          schedule?: Json
          student_id: string
          updated_at?: string
        }
        Update: {
          goal?: number
          notes?: string | null
          plan?: string | null
          schedule?: Json
          student_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      attendance_records: {
        Row: {
          id: string
          marked_at: string
          session_id: string
          student_id: string
        }
        Insert: {
          id?: string
          marked_at?: string
          session_id: string
          student_id: string
        }
        Update: {
          id?: string
          marked_at?: string
          session_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          closed: boolean
          code: string
          expires_at: string
          faculty_id: string
          id: string
          section_id: string | null
          started_at: string
          subject_id: string
        }
        Insert: {
          closed?: boolean
          code: string
          expires_at: string
          faculty_id: string
          id?: string
          section_id?: string | null
          started_at?: string
          subject_id: string
        }
        Update: {
          closed?: boolean
          code?: string
          expires_at?: string
          faculty_id?: string
          id?: string
          section_id?: string | null
          started_at?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "class_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          end_year: number
          id: string
          label: string | null
          start_year: number
        }
        Insert: {
          end_year: number
          id?: string
          label?: string | null
          start_year: number
        }
        Update: {
          end_year?: number
          id?: string
          label?: string | null
          start_year?: number
        }
        Relationships: []
      }
      branches: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      class_sections: {
        Row: {
          branch: string | null
          created_at: string
          division: string | null
          division_id: string | null
          faculty_id: string
          id: string
          name: string
          semester: number | null
          subject_id: string
        }
        Insert: {
          branch?: string | null
          created_at?: string
          division?: string | null
          division_id?: string | null
          faculty_id: string
          id?: string
          name: string
          semester?: number | null
          subject_id: string
        }
        Update: {
          branch?: string | null
          created_at?: string
          division?: string | null
          division_id?: string | null
          faculty_id?: string
          id?: string
          name?: string
          semester?: number | null
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_sections_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_sections_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      divisions: {
        Row: {
          batch_id: string
          branch_id: string
          id: string
          name: string
        }
        Insert: {
          batch_id: string
          branch_id: string
          id?: string
          name: string
        }
        Update: {
          batch_id?: string
          branch_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "divisions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "divisions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      face_enrollments: {
        Row: {
          consent_at: string
          provider: string | null
          status: string
          template_ref: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          consent_at?: string
          provider?: string | null
          status?: string
          template_ref?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          consent_at?: string
          provider?: string | null
          status?: string
          template_ref?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      faculty_requests: {
        Row: {
          created_at: string
          department: string | null
          note: string | null
          reviewed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          note?: string | null
          reviewed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string | null
          note?: string | null
          reviewed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      manual_attendance_requests: {
        Row: {
          created_at: string
          id: string
          reason: string
          session_id: string
          status: string
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          session_id: string
          status?: string
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          session_id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_attendance_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          batch: string | null
          branch: string | null
          college: string | null
          college_email: string | null
          course: string | null
          created_at: string
          division: string | null
          division_id: string | null
          full_name: string
          id: string
          phone: string | null
          student_no: string | null
        }
        Insert: {
          avatar_url?: string | null
          batch?: string | null
          branch?: string | null
          college?: string | null
          college_email?: string | null
          course?: string | null
          created_at?: string
          division?: string | null
          division_id?: string | null
          full_name?: string
          id: string
          phone?: string | null
          student_no?: string | null
        }
        Update: {
          avatar_url?: string | null
          batch?: string | null
          branch?: string | null
          college?: string | null
          college_email?: string | null
          course?: string | null
          created_at?: string
          division?: string | null
          division_id?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          student_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          created_at: string
          file_path: string
          id: string
          kind: string
          section_id: string | null
          size_bytes: number | null
          subject_id: string
          title: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_path: string
          id?: string
          kind?: string
          section_id?: string | null
          size_bytes?: number | null
          subject_id: string
          title: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_path?: string
          id?: string
          kind?: string
          section_id?: string | null
          size_bytes?: number | null
          subject_id?: string
          title?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "class_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      section_members: {
        Row: {
          added_at: string
          section_id: string
          student_id: string
        }
        Insert: {
          added_at?: string
          section_id: string
          student_id: string
        }
        Update: {
          added_at?: string
          section_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_members_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "class_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string
          id: string
          name: string
        }
        Insert: {
          code: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_section_member: {
        Args: { _email: string; _section_id: string }
        Returns: string
      }
      admin_list_students: {
        Args: never
        Returns: {
          division_id: string
          email: string
          full_name: string
          id: string
          student_no: string
        }[]
      }
      admin_set_student_division: {
        Args: { _division_id: string; _user_id: string }
        Returns: undefined
      }
      close_attendance_session: {
        Args: { _session_id: string }
        Returns: undefined
      }
      complete_registration: {
        Args: { _division_id: string; _full_name: string; _student_no: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_section_member: {
        Args: { _section_id: string; _user_id: string }
        Returns: boolean
      }
      list_faculty_requests: {
        Args: never
        Returns: {
          created_at: string
          department: string
          email: string
          full_name: string
          note: string
          status: string
          user_id: string
        }[]
      }
      live_sessions: {
        Args: never
        Returns: {
          already_marked: boolean
          expires_at: string
          faculty_name: string
          id: string
          subject_code: string
          subject_name: string
        }[]
      }
      mark_attendance: { Args: { _code: string }; Returns: string }
      my_attendance_history: {
        Args: never
        Returns: {
          marked_at: string
          present: boolean
          session_id: string
          started_at: string
          subject_code: string
          subject_name: string
        }[]
      }
      my_manual_requests: {
        Args: never
        Returns: {
          created_at: string
          id: string
          reason: string
          section_name: string
          started_at: string
          student_name: string
          student_no: string
          subject_name: string
        }[]
      }
      open_attendance_session: {
        Args: { _minutes?: number; _subject_id: string }
        Returns: {
          closed: boolean
          code: string
          expires_at: string
          faculty_id: string
          id: string
          section_id: string | null
          started_at: string
          subject_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_section_session: {
        Args: { _minutes?: number; _section_id: string }
        Returns: {
          closed: boolean
          code: string
          expires_at: string
          faculty_id: string
          id: string
          section_id: string | null
          started_at: string
          subject_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_session_code: {
        Args: { _minutes?: number; _session_id: string }
        Returns: {
          closed: boolean
          code: string
          expires_at: string
          faculty_id: string
          id: string
          section_id: string | null
          started_at: string
          subject_id: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_face_enrollment: { Args: never; Returns: undefined }
      request_face_enrollment: { Args: never; Returns: string }
      request_manual_attendance: {
        Args: { _reason: string; _session_id: string }
        Returns: undefined
      }
      review_faculty_request: {
        Args: { _approve: boolean; _user_id: string }
        Returns: undefined
      }
      review_manual_request: {
        Args: { _approve: boolean; _id: string }
        Returns: undefined
      }
      section_attendance_summary: {
        Args: { _section_id: string }
        Returns: {
          attended: number
          student_id: string
          student_name: string
          total: number
        }[]
      }
      section_roster: {
        Args: { _section_id: string }
        Returns: {
          added_at: string
          email: string
          student_id: string
          student_name: string
        }[]
      }
      session_attendees: {
        Args: { _session_id: string }
        Returns: {
          marked_at: string
          student_name: string
        }[]
      }
      verify_student: {
        Args: { _student_no: string }
        Returns: {
          avatar_url: string
          batch: string
          college: string
          course: string
          full_name: string
          student_no: string
        }[]
      }
    }
    Enums: {
      app_role: "student" | "faculty" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["student", "faculty", "admin"],
    },
  },
} as const
