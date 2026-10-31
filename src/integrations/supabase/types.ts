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
      admin_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      admin_item_moderation_notes: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          item_id: string
          note: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          item_id: string
          note: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          item_id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_item_moderation_notes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          subject: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          subject: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          subject?: string
        }
        Relationships: []
      }
      item_claims: {
        Row: {
          admin_note: string | null
          claimant_id: string
          created_at: string
          handover_code_hash: string | null
          id: string
          item_category_snapshot: string | null
          item_id: string
          item_location_snapshot: string | null
          item_name_snapshot: string | null
          proof: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          claimant_id: string
          created_at?: string
          handover_code_hash?: string | null
          id?: string
          item_category_snapshot?: string | null
          item_id: string
          item_location_snapshot?: string | null
          item_name_snapshot?: string | null
          proof: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          claimant_id?: string
          created_at?: string
          handover_code_hash?: string | null
          id?: string
          item_category_snapshot?: string | null
          item_id?: string
          item_location_snapshot?: string | null
          item_name_snapshot?: string | null
          proof?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_locations: {
        Row: {
          created_at: string
          item_id: string
          latitude: number
          longitude: number
          user_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          latitude: number
          longitude: number
          user_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          latitude?: number
          longitude?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_locations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_matches: {
        Row: {
          admin_note: string | null
          created_at: string
          found_item_id: string
          id: string
          lost_item_id: string
          match_reason: string | null
          matching_method: string
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          found_item_id: string
          id?: string
          lost_item_id: string
          match_reason?: string | null
          matching_method?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          found_item_id?: string
          id?: string
          lost_item_id?: string
          match_reason?: string | null
          matching_method?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "item_matches_found_item_id_fkey"
            columns: ["found_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_matches_lost_item_id_fkey"
            columns: ["lost_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          item_id: string
          new_status: string
          previous_status: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          item_id: string
          new_status: string
          previous_status?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          item_id?: string
          new_status?: string
          previous_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_status_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          brand: string
          category: string
          color: string
          created_at: string
          id: string
          image_path: string | null
          item_date: string
          item_time: string
          location: string
          model: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_flag: string
          name: string
          note: string
          report_status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand?: string
          category: string
          color?: string
          created_at?: string
          id?: string
          image_path?: string | null
          item_date: string
          item_time?: string
          location: string
          model?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_flag?: string
          name: string
          note?: string
          report_status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand?: string
          category?: string
          color?: string
          created_at?: string
          id?: string
          image_path?: string | null
          item_date?: string
          item_time?: string
          location?: string
          model?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_flag?: string
          name?: string
          note?: string
          report_status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      login_events: {
        Row: {
          id: string
          logged_in_at: string
          login_method: string
          user_id: string
        }
        Insert: {
          id?: string
          logged_in_at?: string
          login_method: string
          user_id: string
        }
        Update: {
          id?: string
          logged_in_at?: string
          login_method?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          phone_number: string | null
          sms_notifications_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          phone_number?: string | null
          sms_notifications_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          phone_number?: string | null
          sms_notifications_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          item_id: string | null
          matched_item_id: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          item_id?: string | null
          matched_item_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          item_id?: string | null
          matched_item_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_matched_item_id_fkey"
            columns: ["matched_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          role: string
          uid: string
          verification_status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          role?: string
          uid: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          role?: string
          uid?: string
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      saved_items: {
        Row: {
          created_at: string
          item_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_review_item_claim: {
        Args: {
          p_admin_note?: string
          p_claim_id: string
          p_handover_code?: string
          p_status: string
        }
        Returns: undefined
      }
      admin_set_student_verification: {
        Args: { p_user_id: string; p_verified: boolean }
        Returns: undefined
      }
      admin_update_item_moderation: {
        Args: { p_flag: string; p_item_id: string; p_note?: string }
        Returns: undefined
      }
      consume_edge_rate_limit: {
        Args: {
          p_key_hash: string
          p_max_requests: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      health_check: { Args: never; Returns: boolean }
      search_items: {
        Args: {
          p_category?: string
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_sort?: string
          p_type?: string
        }
        Returns: {
          brand: string
          category: string
          color: string
          created_at: string
          id: string
          image_path: string | null
          item_date: string
          item_time: string
          location: string
          model: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_flag: string
          name: string
          note: string
          report_status: string
          type: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_items_v2: {
        Args: {
          p_category?: string
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_location?: string
          p_offset?: number
          p_query?: string
          p_saved_only?: boolean
          p_sort?: string
          p_status?: string
          p_type?: string
        }
        Returns: {
          brand: string
          category: string
          color: string
          created_at: string
          id: string
          image_path: string | null
          item_date: string
          item_time: string
          location: string
          model: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_flag: string
          name: string
          note: string
          report_status: string
          type: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
